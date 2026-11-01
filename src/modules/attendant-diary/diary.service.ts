import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_CONVERSATION_MODEL } from '../ai-agents/llm/llm.constants';
import type { LlmContent } from '../ai-agents/llm/llm.types';
import { isWithinHours } from '../routing/availability/business-hours.util';
import { dayRange } from './diary-day';
import { DiaryCriteriaService, type LoadedCriteria } from './diary-criteria.service';
import { buildDiaryPrompt, parseDiaryEvaluation } from './diary-evaluation';
import { computeDiaryMetrics } from './diary-metrics';
import { buildTranscripts, selectConversationIds } from './diary-transcripts';
import { DIARY_MAX_TOKENS } from './diary.constants';
import { DiaryRepository, type DiaryRecord } from './diary.repository';
import type { DiaryGenerateJobData, DiaryStatus, DiaryTranscript } from './diary.types';

export type DiaryOutcome = DiaryStatus | 'SKIPPED';

const NO_CRITERIA_ERROR = 'Nenhum critério ativo com instruções.';
const UNREADABLE_ERROR = 'A IA devolveu uma resposta que não pôde ser lida.';

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
    const metrics = computeDiaryMetrics(dayMessages, userId, (at) =>
      isWithinHours(member.workingHours, member.timeZone, at),
    );
    const onlineMinutes = await this.repository.findOnlineMinutes(organizationId, userId, day);
    const base = {
      organizationId,
      userId,
      day,
      metrics: { ...metrics, onlineMinutes },
    };

    const conversationIds = selectConversationIds(dayMessages, userId);
    if (conversationIds.length === 0) {
      return this.save({ ...base, status: 'EMPTY', conversationsAnalyzed: 0 });
    }

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
    return this.evaluate(base, member.name, loaded, transcripts);
  }

  private async evaluate(
    base: Pick<DiaryRecord, 'organizationId' | 'userId' | 'day' | 'metrics'>,
    attendantName: string,
    loaded: LoadedCriteria,
    transcripts: DiaryTranscript[],
  ): Promise<DiaryOutcome> {
    const audit = {
      ...base,
      conversationsAnalyzed: transcripts.length,
      criteriaVersions: loaded.versions,
    };
    const prompt = buildDiaryPrompt({
      attendantName,
      criteria: loaded.criteria,
      transcripts,
    });

    try {
      const response = await this.llm.complete({
        organizationId: base.organizationId,
        modelId: SAKANA_CONVERSATION_MODEL,
        temperature: 0.2,
        maxTokens: DIARY_MAX_TOKENS,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      });
      const paid = {
        ...audit,
        modelId: response.rawModelId,
        costUsd: response.usage.costUsd,
      };
      const evaluation = parseDiaryEvaluation(
        contentToText(response.message.content),
        transcripts,
      );
      if (!evaluation) {
        return this.save({ ...paid, status: 'FAILED', errorMessage: UNREADABLE_ERROR });
      }
      return this.save({
        ...paid,
        status: 'READY',
        summary: evaluation.summary,
        strengths: evaluation.strengths,
        improvements: evaluation.improvements,
        discardedPoints: evaluation.discarded,
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(
        `diary_llm_failed user=${base.userId} day=${base.day}: ${message}`,
      );
      return this.save({ ...audit, status: 'FAILED', errorMessage: message });
    }
  }

  private async save(record: DiaryRecord): Promise<DiaryStatus> {
    await this.repository.saveDiary(record);
    this.logger.log(
      `diary_saved user=${record.userId} day=${record.day} status=${record.status} cost=${record.costUsd ?? 0}`,
    );
    return record.status;
  }
}
