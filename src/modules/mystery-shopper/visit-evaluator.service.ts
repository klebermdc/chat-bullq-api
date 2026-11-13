// src/modules/mystery-shopper/visit-evaluator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_CONVERSATION_MODEL } from '../ai-agents/llm/llm.constants';
import type { LlmContent } from '../ai-agents/llm/llm.types';
import { stripThinkBlocks } from '../ai-agents/runner/text-guards';
import { EVALUATION_MAX_TOKENS, MAX_EVALUATION_ATTEMPTS } from './mystery-shopper.constants';
import { MysteryShopperCriteriaService } from './mystery-shopper-criteria.service';
import { MysteryShopperNotifier } from './mystery-shopper.notifier';
import { MysteryShopperRepository, type VisitForEvaluation } from './mystery-shopper.repository';
import type { EvaluationResult, VisitCriterion, VisitEvaluation, VisitLine } from './mystery-shopper.types';
import {
  applyCodeRules,
  buildVisitPrompt,
  hasForeignScript,
  noReplyEvaluation,
  parseVisitEvaluation,
  totalScore,
  withoutForeignScript,
} from './visit-evaluation';
import { computeVisitMetrics } from './visit-metrics';
import { buildVisitLines } from './visit-transcript';

export type EvaluationOutcome = 'DONE' | 'FAILED' | 'SKIPPED';

const NO_CRITERIA_ERROR = 'Nenhum critério ativo com instruções.';
const UNREADABLE_ERROR = 'A IA devolveu uma resposta que não pôde ser lida.';
const RETRY_REMINDER =
  'A tentativa anterior veio ilegível ou com outro idioma. Responda só o JSON pedido, em português do Brasil.';

function llmText(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** Avalia uma visita: métricas por código + rubrica pela IA da org. */
@Injectable()
export class VisitEvaluatorService {
  private readonly logger = new Logger(VisitEvaluatorService.name);

  constructor(
    private readonly repository: MysteryShopperRepository,
    private readonly criteria: MysteryShopperCriteriaService,
    private readonly llm: LlmService,
    private readonly notifier: MysteryShopperNotifier,
  ) {}

  async evaluate(visitId: string): Promise<EvaluationOutcome> {
    const visit = await this.repository.findVisitForEvaluation(visitId);
    if (!visit || visit.status !== 'EVALUATING') return 'SKIPPED';
    try {
      const result = await this.run(visit);
      await this.repository.saveEvaluation(visit.id, result);
      this.logger.log(`mystery_visit_done visit=${visit.id} score=${result.totalScore} cost=${result.costUsd}`);
      await this.notifier.notifyDone(visit.organizationId, {
        visitId: visit.id,
        sellerName: result.sellerName,
        totalScore: result.totalScore,
        scores: result.scores,
      });
      return 'DONE';
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`mystery_visit_failed visit=${visit.id}: ${message}`);
      await this.repository.recordFailure(visit.id, message, visit.evaluatedAt !== null);
      return 'FAILED';
    }
  }

  private async run(visit: VisitForEvaluation): Promise<EvaluationResult> {
    const [messages, assignedAt, proposalCount, criteria, productRules] = await Promise.all([
      this.repository.findMessages(visit.conversationId),
      this.repository.findFirstAssignment(visit.conversationId),
      this.repository.countProposals(visit.conversationId),
      this.criteria.loadCriteria(visit.organizationId),
      this.criteria.loadProductRules(visit.organizationId),
    ]);
    if (criteria.length === 0) throw new Error(NO_CRITERIA_ERROR);

    const metrics = computeVisitMetrics({ messages, assignedAt, proposalCount });
    const lines = buildVisitLines(messages);
    const sellerUserId = visit.assignedToId;
    const names = await this.repository.findUserNames(sellerUserId ? [sellerUserId] : []);
    const sellerName = (sellerUserId && names.get(sellerUserId)) || null;

    const { evaluation, costUsd } =
      metrics.humanMessages === 0
        ? { evaluation: noReplyEvaluation(criteria), costUsd: 0 }
        : await this.ask(
            visit.organizationId,
            buildVisitPrompt({ sellerName, scenario: visit.scenario, criteria, productRules, metrics, lines }),
            criteria,
            lines,
          );

    const scores = applyCodeRules(evaluation.scores, metrics);
    return { sellerUserId, sellerName, metrics, scores, totalScore: totalScore(scores), summary: evaluation.summary, costUsd };
  }

  /** Refaz se vier ilegível ou com outro idioma; outro idioma que persiste é removido. */
  private async ask(
    organizationId: string,
    prompt: { system: string; user: string },
    criteria: VisitCriterion[],
    lines: VisitLine[],
  ): Promise<{ evaluation: VisitEvaluation; costUsd: number }> {
    let costUsd = 0;
    let foreign: VisitEvaluation | null = null;
    for (let attempt = 0; attempt < MAX_EVALUATION_ATTEMPTS; attempt += 1) {
      const response = await this.llm.complete({
        organizationId,
        modelId: SAKANA_CONVERSATION_MODEL,
        temperature: 0.2,
        maxTokens: EVALUATION_MAX_TOKENS,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: attempt === 0 ? prompt.user : `${prompt.user}\n\n${RETRY_REMINDER}` },
        ],
      });
      costUsd += response.usage.costUsd;
      const evaluation = parseVisitEvaluation(stripThinkBlocks(llmText(response.message.content)), criteria, lines);
      if (!evaluation) continue;
      if (!hasForeignScript(evaluation)) return { evaluation, costUsd };
      foreign = evaluation;
    }
    if (foreign) return { evaluation: withoutForeignScript(foreign), costUsd };
    throw new Error(UNREADABLE_ERROR);
  }
}
