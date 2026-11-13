import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CallStatus, MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CallInsightService } from '../calls/call-insight.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/**
 * Registro da ligação do vendedor pelo WhatsApp na tabela `calls` (a mesma do
 * Sonax): o cartão da ligação na conversa, a transcrição que o agente manda no
 * fim e o resumo pela IA da agência. Sem áudio guardado.
 */
export const WHATSAPP_RAMAL = 'whatsapp';

const OUTBOUND: MessageDirection = 'OUTBOUND';
const SYSTEM: MessageContentType = 'SYSTEM';
const SENT: MessageStatus = 'SENT';

export interface TranscriptInput {
  callId: string;
  answered: boolean;
  durationSec: number;
  segments: { quem: 'cliente' | 'vendedor'; texto: string }[];
}

const SPEAKER_LABEL = { cliente: 'Cliente', vendedor: 'Vendedor' } as const;

/** "Cliente: …\nVendedor: …" (o formato que o resumo e a tela leem). */
export function formatTranscript(segments: TranscriptInput['segments']): string {
  return segments.map((s) => `${SPEAKER_LABEL[s.quem]}: ${s.texto}`).join('\n');
}

interface CallRow {
  id: string;
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  status: CallStatus;
  answered: boolean;
  durationSec: number | null;
  insightState: string | null;
  insight: unknown;
}

/** Conteúdo do cartão da ligação (mesmo formato do CallCard do web). */
export function callCardContent(call: Pick<CallRow, 'id' | 'status' | 'answered' | 'durationSec' | 'insightState' | 'insight'>, hasTranscript = false) {
  return {
    kind: 'call',
    via: 'whatsapp',
    callId: call.id,
    status: call.status,
    answered: call.answered,
    durationSec: call.durationSec,
    insightState: call.insightState,
    insight: call.insight ?? null,
    hasTranscript,
  };
}

@Injectable()
export class SellerCallRecordService {
  private readonly logger = new Logger(SellerCallRecordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly insight: CallInsightService,
  ) {}

  /** Abre o registro e põe o cartão "Ligação iniciada" na conversa. */
  async open(input: { organizationId: string; conversation: { id: string; channelId: string; contactId: string }; agentId: string; numero: string }): Promise<string> {
    const call = await this.prisma.call.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversation.id,
        agentId: input.agentId,
        ramal: WHATSAPP_RAMAL,
        numero: input.numero,
        status: 'DIALING',
        insightState: 'PENDING',
      },
    });
    const message = await this.prisma.message.create({
      data: {
        conversationId: input.conversation.id,
        direction: OUTBOUND,
        type: SYSTEM,
        status: SENT,
        sentAt: new Date(),
        senderId: input.agentId,
        content: callCardContent(call) as object,
        metadata: { source: 'seller-call', callId: call.id },
      },
    });
    await this.prisma.call.update({ where: { id: call.id }, data: { messageId: message.id } });
    this.realtime.emitToChannel(input.conversation.channelId, 'message:new', { message, conversationId: input.conversation.id, contactId: input.conversation.contactId });
    this.realtime.emitToConversation(input.conversation.id, 'message:new', { message });
    return call.id;
  }

  /** A discagem falhou: cartão "Falha ao iniciar". */
  async fail(callId: string): Promise<void> {
    const call = await this.prisma.call.update({ where: { id: callId }, data: { status: 'FAILED', endedAt: new Date(), insightState: 'SKIPPED' } });
    await this.refreshCard(call);
  }

  /** Fim da ligação (vem do agente): grava a transcrição e gera o resumo sem segurar a resposta. */
  async finish(input: TranscriptInput): Promise<{ ok: true }> {
    const found = await this.prisma.call.findFirst({ where: { id: input.callId, ramal: WHATSAPP_RAMAL } });
    if (!found) throw new NotFoundException('Ligação não encontrada');
    if (found.status === 'FAILED' || found.endedAt) return { ok: true };
    const transcript = formatTranscript(input.segments);
    const toSummarize = input.answered && transcript.length > 0;
    const call = await this.prisma.call.update({
      where: { id: found.id },
      data: {
        status: input.answered ? 'FINISHED' : 'NO_ANSWER',
        answered: input.answered,
        durationSec: input.answered ? input.durationSec : null,
        endedAt: new Date(),
        transcript: transcript || null,
        insightState: toSummarize ? 'PENDING' : 'SKIPPED',
      },
    });
    await this.refreshCard(call, !!transcript);
    if (toSummarize) void this.summarize(call, transcript);
    return { ok: true };
  }

  private async summarize(call: CallRow, transcript: string): Promise<void> {
    let updated: CallRow;
    try {
      const insight = await this.insight.summarize(call.organizationId, transcript);
      updated = await this.prisma.call.update({ where: { id: call.id }, data: { insight: insight as object, insightState: 'READY' } });
    } catch (err) {
      this.logger.warn(`Resumo da ligação ${call.id} falhou (transcrição salva): ${(err as Error).message}`);
      updated = await this.prisma.call.update({ where: { id: call.id }, data: { insightState: 'FAILED' } });
    }
    // Mesmo aviso do resumo do Sonax: o painel da conversa recarrega o resumo/transcrição.
    this.realtime.emitToConversation(call.conversationId, 'call:insight', { callId: call.id, insightState: updated.insightState, insight: updated.insight ?? null, hasTranscript: true });
    await this.refreshCard(updated, true).catch((err) => this.logger.warn(`Cartão da ligação ${call.id}: ${(err as Error).message}`));
  }

  private async refreshCard(call: CallRow, hasTranscript = false): Promise<void> {
    if (!call.messageId) return;
    const content = callCardContent(call, hasTranscript);
    await this.prisma.message.update({ where: { id: call.messageId }, data: { content: content as object } });
    this.realtime.emitToConversation(call.conversationId, 'message:update', { messageId: call.messageId, content });
  }
}
