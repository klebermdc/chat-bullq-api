import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_CONVERSATION_MODEL } from '../ai-agents/llm/llm.constants';
import type { LlmContent } from '../ai-agents/llm/llm.types';
import { isWithinHours } from '../routing/availability/business-hours.util';
import { dayRange } from './diary-day';
import { DiaryCriteriaService, type LoadedCriteria } from './diary-criteria.service';
import {
  buildConsolidationPrompt,
  buildDiaryPrompt,
  hasForeignScript,
  parseConsolidation,
  parseDiaryEvaluation,
} from './diary-evaluation';
import { computeDiaryMetrics, findUnanswered } from './diary-metrics';
import { buildTranscripts, selectConversationIds } from './diary-transcripts';
import {
  DIARY_BATCH_SIZE,
  DIARY_MAX_TOKENS,
  MAX_EVALUATION_ATTEMPTS,
} from './diary.constants';
import { DiaryRepository, UNKNOWN_CONTACT, type DiaryRecord } from './diary.repository';
import type {
  DiaryEvaluation,
  DiaryGenerateJobData,
  DiaryPending,
  DiaryStatus,
  DiaryTranscript,
} from './diary.types';

export type DiaryOutcome = DiaryStatus | 'SKIPPED';

const NO_CRITERIA_ERROR = 'Nenhum critério ativo com instruções.';
const UNREADABLE_ERROR = 'A IA devolveu uma resposta que não pôde ser lida.';
const FOREIGN_SCRIPT_ERROR = 'A IA misturou outro idioma no texto. Gere de novo.';
const LANGUAGE_REMINDER =
  'A tentativa anterior misturou outro idioma. Refaça tudo somente em português do Brasil.';

/** Quanto as chamadas à IA já custaram, para registrar mesmo em caso de falha. */
interface DiarySpend {
  costUsd: number;
  modelId?: string;
}

function toBatches(transcripts: DiaryTranscript[]): DiaryTranscript[][] {
  const count = Math.ceil(transcripts.length / DIARY_BATCH_SIZE);
  return Array.from({ length: count }, (_, index) =>
    transcripts.slice(index * DIARY_BATCH_SIZE, (index + 1) * DIARY_BATCH_SIZE),
  );
}

function contentToText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/** Monta o diário de um atendente em um dia: métricas, avaliação e gravação. */
@Injectable()
export class DiaryService {
  private readonly logger = new Logger(DiaryService.name);

  constructor(
    private readonly repository: DiaryRepository,
    private readonly criteria: DiaryCriteriaService,
    private readonly llm: LlmService,
  ) {}

  async generate(job: DiaryGenerateJobData): Promise<DiaryOutcome> {
    const { organizationId, userId, day, force } = job;

    const existing = await this.repository.findDiary(organizationId, userId, day);
    if (existing?.status === 'READY' && !force) return 'SKIPPED';

    const member = await this.repository.findMember(organizationId, userId);
    if (!member) return 'SKIPPED';

    const range = dayRange(day, member.timeZone);
    const dayMessages = await this.repository.findDayMessages(organizationId, userId, range);
    const isWorkingTime = (at: Date) =>
      isWithinHours(member.workingHours, member.timeZone, at);
    const metrics = computeDiaryMetrics(dayMessages, userId, isWorkingTime);
    const unanswered = findUnanswered(dayMessages, userId, isWorkingTime);
    const onlineMinutes = await this.repository.findOnlineMinutes(organizationId, userId, day);
    const conversationIds = selectConversationIds(dayMessages, userId);
    const names = await this.repository.findContactNames([
      ...new Set([...conversationIds, ...unanswered.map((u) => u.conversationId)]),
    ]);
    const pending: DiaryPending[] = unanswered.map((u) => ({
      conversationId: u.conversationId,
      contactName: names.get(u.conversationId) ?? UNKNOWN_CONTACT,
      waitingSince: u.since.toISOString(),
    }));
    const base = {
      organizationId,
      userId,
      day,
      metrics: { ...metrics, onlineMinutes },
      details: { pending },
    };

    if (conversationIds.length === 0) {
      return this.save({ ...base, status: 'EMPTY', conversationsAnalyzed: 0 });
    }

    const keepsReady = existing?.status === 'READY';
    const loaded = await this.criteria.loadCriteria(organizationId);
    if (loaded.criteria.length === 0) {
      return this.save({
        ...base,
        status: 'FAILED',
        conversationsAnalyzed: 0,
        errorMessage: NO_CRITERIA_ERROR,
      });
    }

    const context = await this.repository.findContextMessages(conversationIds, range.from);
    const transcripts = buildTranscripts(dayMessages, context, userId);
    return this.evaluate(base, member.name, loaded, transcripts, names, keepsReady);
  }

  private async evaluate(
    base: Pick<DiaryRecord, 'organizationId' | 'userId' | 'day' | 'metrics' | 'details'>,
    attendantName: string,
    loaded: LoadedCriteria,
    transcripts: DiaryTranscript[],
    names: Map<string, string>,
    keepsReady: boolean,
  ): Promise<DiaryOutcome> {
    const audit = {
      ...base,
      conversationsAnalyzed: transcripts.length,
      criteriaVersions: loaded.versions,
    };
    const spent: DiarySpend = { costUsd: 0 };

    try {
      const parts: DiaryEvaluation[] = [];
      for (const batch of toBatches(transcripts)) {
        const prompt = buildDiaryPrompt({ attendantName, criteria: loaded.criteria, transcripts: batch });
        const part = await this.askEvaluation(base.organizationId, prompt, spent, (raw) =>
          parseDiaryEvaluation(raw, batch),
        );
        parts.push(part);
      }
      const evaluation =
        parts.length === 1
          ? parts[0]
          : await this.askEvaluation(
              base.organizationId,
              buildConsolidationPrompt(attendantName, parts),
              spent,
              (raw) => parseConsolidation(raw, parts),
            );
      return await this.saveEvaluation({ ...audit, ...spent }, evaluation, names);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(
        `diary_llm_failed user=${base.userId} day=${base.day}: ${message}`,
      );
      if (keepsReady) {
        await this.repository.recordFailure({ ...base, errorMessage: message, costUsd: spent.costUsd });
        return 'FAILED';
      }
      return this.save({ ...audit, ...spent, status: 'FAILED', errorMessage: message });
    }
  }

  /** Pede à IA e refaz uma vez se o texto vier misturado com outro idioma. */
  private async askEvaluation(
    organizationId: string,
    prompt: { system: string; user: string },
    spent: DiarySpend,
    parse: (raw: string) => DiaryEvaluation | null,
  ): Promise<DiaryEvaluation> {
    for (let attempt = 0; attempt < MAX_EVALUATION_ATTEMPTS; attempt += 1) {
      const response = await this.llm.complete({
        organizationId,
        modelId: SAKANA_CONVERSATION_MODEL,
        temperature: 0.2,
        maxTokens: DIARY_MAX_TOKENS,
        messages: [
          { role: 'system', content: prompt.system },
          {
            role: 'user',
            content: attempt === 0 ? prompt.user : `${prompt.user}\n\n${LANGUAGE_REMINDER}`,
          },
        ],
      });
      spent.modelId = response.rawModelId;
      spent.costUsd += response.usage.costUsd;
      const evaluation = parse(contentToText(response.message.content));
      if (!evaluation) throw new Error(UNREADABLE_ERROR);
      if (!hasForeignScript(evaluation)) return evaluation;
    }
    throw new Error(FOREIGN_SCRIPT_ERROR);
  }

  private saveEvaluation(
    audit: Omit<DiaryRecord, 'status'>,
    evaluation: DiaryEvaluation,
    names: Map<string, string>,
  ): Promise<DiaryStatus> {
    return this.save({
      ...audit,
      status: 'READY',
      summary: evaluation.summary,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      discardedPoints: evaluation.discarded,
      details: {
        ...audit.details,
        focus: evaluation.focus,
        scores: evaluation.scores,
        practice: evaluation.practice,
        conversations: evaluation.conversations.map((c) => ({
          ...c,
          contactName: names.get(c.conversationId) ?? UNKNOWN_CONTACT,
        })),
      },
    });
  }

  private async save(record: DiaryRecord): Promise<DiaryStatus> {
    await this.repository.saveDiary(record);
    this.logger.log(
      `diary_saved user=${record.userId} day=${record.day} status=${record.status} cost=${record.costUsd ?? 0}`,
    );
    return record.status;
  }
}
