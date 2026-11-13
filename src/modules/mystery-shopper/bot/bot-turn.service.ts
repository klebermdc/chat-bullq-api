import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import type { MysteryShopperBotStatus } from '@prisma/client';
import { LlmService } from '../../ai-agents/llm/llm.service';
import { SAKANA_CONVERSATION_MODEL } from '../../ai-agents/llm/llm.constants';
import type { LlmContent } from '../../ai-agents/llm/llm.types';
import { MysteryShopperRepository } from '../mystery-shopper.repository';
import { SimulatedRecipients } from '../simulated/simulated-recipients.service';
import { SimulatorService } from '../simulated/simulator.service';
import {
  BOT_DEFAULT_TIMEZONE,
  BOT_HISTORY_LIMIT,
  BOT_MAX_ATTEMPTS,
  BOT_MAX_CLIENT_MESSAGES,
  BOT_MAX_TOKENS,
  BOT_MORNING_JITTER_MS,
  BOT_READ_DELAY_MAX_MS,
  BOT_READ_DELAY_MIN_MS,
  BOT_TEMPERATURE,
} from './bot.constants';
import { BotRepository, type BotRunRow } from './bot.repository';
import { buildBotPrompt, msUntilBotWindow, parseBotReply, type BotLine, type BotReply } from './bot-turn';

export type BotTurnOutcome =
  | { kind: 'SENT' | 'SILENT' | 'SKIPPED' | 'FAILED' }
  | { kind: 'DELAYED'; delayMs: number };

const UNREADABLE_ERROR = 'A IA devolveu uma resposta ilegível ou em outro idioma.';
const NOT_SIMULATED_ERROR = 'O contato não é simulado: nada foi enviado.';
const NUMBER_GONE_ERROR = 'O número simulado não existe mais.';
const RETRY_REMINDER =
  'A tentativa anterior veio ilegível ou com outro idioma. Responda só o JSON pedido, em português do Brasil.';

function llmText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

type LiveRun = BotRunRow & { status: 'ACTIVE' | 'CLOSING' };

const isLive = (run: BotRunRow | null): run is LiveRun =>
  run !== null && (run.status === 'ACTIVE' || run.status === 'CLOSING');

/** Um turno do robô: lê a conversa, pergunta à IA da org e (se couber) responde como o cliente. */
@Injectable()
export class BotTurnService {
  private readonly logger = new Logger(BotTurnService.name);

  constructor(
    private readonly repository: BotRepository,
    private readonly numbers: MysteryShopperRepository,
    private readonly simulator: SimulatorService,
    private readonly recipients: SimulatedRecipients,
    private readonly llm: LlmService,
  ) {}

  async run(runId: string, now: Date = new Date()): Promise<BotTurnOutcome> {
    const run = await this.repository.findRun(runId);
    if (!isLive(run) || (run.status === 'CLOSING' && run.followUpAnswered)) return { kind: 'SKIPPED' };

    const wait = await this.waitForWindow(run, now);
    if (wait > 0) return { kind: 'DELAYED', delayMs: wait + randomInt(0, BOT_MORNING_JITTER_MS) };

    const number = await this.numbers.findNumberForSimulator(run.organizationId, run.numberId);
    if (!number) return this.fail(run, NUMBER_GONE_ERROR, 0);
    // Trava dura: o robô só fala com contato simulado.
    if (!(await this.recipients.isSimulatedContact(number.contactId))) return this.fail(run, NOT_SIMULATED_ERROR, 0);

    const conversation = await this.simulator.getConversation(run.organizationId, run.numberId);
    const lines = conversation.messages.slice(-BOT_HISTORY_LIMIT).map((m): BotLine => ({ from: m.from, text: m.text }));
    // Nada novo da equipe desde a última fala do cliente: não responde duas vezes.
    if (lines.length === 0 || lines[lines.length - 1].from !== 'EMPRESA') return { kind: 'SKIPPED' };

    const forceEnd = run.status === 'ACTIVE' && run.clientMessages >= BOT_MAX_CLIENT_MESSAGES;
    const prompt = buildBotPrompt({ persona: run.persona, status: run.status, clientMessages: run.clientMessages, forceEnd, lines });
    const { reply, costUsd } = await this.ask(run.organizationId, prompt);
    if (!reply) return this.fail(run, UNREADABLE_ERROR, costUsd);

    // Parar durante a chamada da IA vence.
    if (!isLive(await this.repository.findRun(runId))) return { kind: 'SKIPPED' };

    const snapshotLastId = conversation.messages[conversation.messages.length - 1].id;
    const outcome = await this.apply(run, reply, forceEnd, costUsd);
    return (await this.followUpIfTeamWrote(run, snapshotLastId)) ?? outcome;
  }

  /**
   * A equipe escreveu durante o turno: o acordar do adaptador não conseguiu recriar o job (este estava ativo).
   * Devolve DELAYED e o processor atrasa ESTE mesmo job (mesmo jobId, concorrência 1): turnos seguem serializados.
   */
  private async followUpIfTeamWrote(run: LiveRun, snapshotLastId: string): Promise<BotTurnOutcome | null> {
    const fresh = await this.repository.findRun(run.id);
    if (!isLive(fresh) || (fresh.status === 'CLOSING' && fresh.followUpAnswered)) return null;
    const { messages } = await this.simulator.getConversation(run.organizationId, run.numberId);
    const last = messages[messages.length - 1];
    if (!last || last.from !== 'EMPRESA' || last.id === snapshotLastId) return null;
    return { kind: 'DELAYED', delayMs: randomInt(BOT_READ_DELAY_MIN_MS, BOT_READ_DELAY_MAX_MS + 1) };
  }

  private async apply(run: LiveRun, reply: BotReply, forceEnd: boolean, costUsd: number): Promise<BotTurnOutcome> {
    if (reply.acao === 'silencio') {
      await this.repository.recordTurn(run.id, { status: run.status, sent: false, followUpAnswered: false, costUsd });
      return { kind: 'SILENT' };
    }
    await this.simulator.sendMessage(run.organizationId, run.numberId, reply.mensagem);
    const closing = run.status === 'CLOSING';
    const status: MysteryShopperBotStatus = closing ? 'ENDED' : reply.acao === 'encerrar' || forceEnd ? 'CLOSING' : 'ACTIVE';
    await this.repository.recordTurn(run.id, { status, sent: true, followUpAnswered: closing, costUsd });
    this.logger.log(`bot_turn_sent run=${run.id} acao=${reply.acao} status=${status}`);
    return { kind: 'SENT' };
  }

  /** Cliente real não responde de madrugada: fora de 08:00–22:30 o turno espera a manhã. */
  private async waitForWindow(run: BotRunRow, now: Date): Promise<number> {
    const timezone = (await this.repository.findTimezone(run.organizationId)) || BOT_DEFAULT_TIMEZONE;
    return msUntilBotWindow(now, timezone);
  }

  private async fail(run: BotRunRow, error: string, costUsd: number): Promise<BotTurnOutcome> {
    this.logger.warn(`bot_turn_failed run=${run.id}: ${error}`);
    await this.repository.failRun(run.id, error, costUsd);
    return { kind: 'FAILED' };
  }

  /** Até 2 tentativas; erro da IA, JSON ilegível e outro alfabeto contam como tentativa perdida. */
  private async ask(
    organizationId: string,
    prompt: { system: string; user: string },
  ): Promise<{ reply: BotReply | null; costUsd: number }> {
    let costUsd = 0;
    for (let attempt = 0; attempt < BOT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.llm.complete({
          organizationId,
          modelId: SAKANA_CONVERSATION_MODEL,
          temperature: BOT_TEMPERATURE,
          maxTokens: BOT_MAX_TOKENS,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: attempt === 0 ? prompt.user : `${prompt.user}\n\n${RETRY_REMINDER}` },
          ],
        });
        costUsd += response.usage.costUsd;
        const reply = parseBotReply(llmText(response.message.content));
        if (reply) return { reply, costUsd };
      } catch (err) {
        this.logger.warn(`bot_turn_llm_error attempt=${attempt}: ${(err as Error).message}`);
      }
    }
    return { reply: null, costUsd };
  }
}
