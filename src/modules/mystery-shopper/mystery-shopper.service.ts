import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MysteryShopperVisitStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { normalizePhone } from '../../common/utils/phone.util';
import {
  EVALUATE_JOB,
  FOLLOW_UP_WINDOW_HOURS,
  MYSTERY_SHOPPER_QUEUE,
  RANKING_DAYS,
  STUCK_EVALUATING_MINUTES,
  evaluateJobOptions,
} from './mystery-shopper.constants';
import { MysteryShopperRepository, type NumberRow, type VisitRow } from './mystery-shopper.repository';
import type { CriterionScore, VisitMetrics, VisitSummary } from './mystery-shopper.types';
import { buildRanking, type RankingRow } from './visit-ranking';
import { buildVisitLines } from './visit-transcript';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;
const RE_EVALUABLE: MysteryShopperVisitStatus[] = ['OPEN', 'DONE', 'FAILED'];

export interface VisitListItem {
  id: string;
  status: MysteryShopperVisitStatus;
  scenario: string | null;
  sellerName: string | null;
  totalScore: number | null;
  createdAt: Date;
  closesAt: Date | null;
  evaluatedAt: Date | null;
  error: string | null;
}

export interface VisitDetail extends VisitListItem {
  metrics: VisitMetrics | null;
  scores: CriterionScore[];
  summary: VisitSummary | null;
  lines: Array<{ messageId: string; role: string; text: string; createdAt: Date }>;
}

const isFilled = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v as object).length > 0;

/** Varredura das visitas e ações da página. Quem chama já conferiu o acesso. */
@Injectable()
export class MysteryShopperService {
  private readonly logger = new Logger(MysteryShopperService.name);

  constructor(
    private readonly repository: MysteryShopperRepository,
    @InjectQueue(MYSTERY_SHOPPER_QUEUE) private readonly queue: Queue,
  ) {}

  async sweep(now: Date = new Date()): Promise<{ opened: number; queued: number; requeued: number }> {
    const opened = await this.openNewVisits();
    const cutoff = new Date(now.getTime() - FOLLOW_UP_WINDOW_HOURS * HOUR_MS);
    let queued = 0;
    for (const id of await this.repository.findDueOpenVisitIds(cutoff)) {
      try {
        if (await this.repository.markEvaluating({ id, from: ['OPEN'], closedAt: now })) {
          await this.enqueue(id);
          queued += 1;
        }
      } catch (err) {
        this.logSweepFailure(`visit=${id}`, err);
      }
    }
    const stuckBefore = new Date(now.getTime() - STUCK_EVALUATING_MINUTES * MINUTE_MS);
    let requeued = 0;
    for (const id of await this.repository.findStuckEvaluatingIds(stuckBefore)) {
      try {
        await this.enqueue(id);
        requeued += 1;
      } catch (err) {
        this.logSweepFailure(`visit=${id}`, err);
      }
    }
    if (opened || queued || requeued) {
      this.logger.log(`mystery_sweep opened=${opened} queued=${queued} requeued=${requeued}`);
    }
    return { opened, queued, requeued };
  }

  private async openNewVisits(): Promise<number> {
    let opened = 0;
    for (const number of await this.repository.findActiveNumbers()) {
      try {
        for (const conversationId of await this.repository.findConversationsWithoutVisit(number)) {
          if (await this.repository.createVisit(number, conversationId)) opened += 1;
        }
      } catch (err) {
        this.logSweepFailure(`number=${number.id}`, err);
      }
    }
    return opened;
  }

  private logSweepFailure(item: string, err: unknown) {
    this.logger.warn(`mystery_sweep_item_failed ${item}: ${(err as Error).message}`);
  }

  async requestEvaluation(organizationId: string, id: string, now: Date = new Date()): Promise<{ queued: true }> {
    const visit = await this.repository.findVisit(organizationId, id);
    if (!visit) throw new NotFoundException();
    if (!RE_EVALUABLE.includes(visit.status)) {
      throw new BadRequestException('Esta visita não pode ser avaliada agora.');
    }
    const changed = await this.repository.markEvaluating({
      id,
      organizationId,
      from: [visit.status],
      closedAt: visit.closedAt ?? now,
    });
    if (!changed) throw new BadRequestException('A visita mudou de estado. Atualize a página.');
    // Se o enqueue falhar, o erro sobe de propósito: a visita fica em EVALUATING e a varredura
    // a reenfileira depois de STUCK_EVALUATING_MINUTES.
    await this.enqueue(id);
    return { queued: true };
  }

  async discard(organizationId: string, id: string): Promise<{ discarded: true }> {
    if (!(await this.repository.discard(organizationId, id))) throw new NotFoundException();
    return { discarded: true };
  }

  async updateScenario(organizationId: string, id: string, scenario: string): Promise<{ updated: true }> {
    const value = scenario.trim() || null;
    if (!(await this.repository.updateScenario(organizationId, id, value))) throw new NotFoundException();
    return { updated: true };
  }

  async listVisits(organizationId: string): Promise<VisitListItem[]> {
    const rows = await this.repository.listVisits(organizationId);
    const names = await this.repository.findUserNames(rows.flatMap((r) => this.sellerIdOf(r) ?? []));
    return rows.map((r) => this.toListItem(r, names));
  }

  async getVisit(organizationId: string, id: string): Promise<VisitDetail> {
    const row = await this.repository.findVisit(organizationId, id);
    if (!row) throw new NotFoundException();
    const sellerId = this.sellerIdOf(row);
    const [names, messages] = await Promise.all([
      this.repository.findUserNames(sellerId ? [sellerId] : []),
      this.repository.findMessages(row.conversationId),
    ]);
    return {
      ...this.toListItem(row, names),
      metrics: isFilled(row.metrics) ? (row.metrics as unknown as VisitMetrics) : null,
      scores: Array.isArray(row.scores) ? (row.scores as unknown as CriterionScore[]) : [],
      summary: isFilled(row.summary) ? (row.summary as unknown as VisitSummary) : null,
      lines: buildVisitLines(messages, sellerId),
    };
  }

  async ranking(organizationId: string, now: Date = new Date()): Promise<RankingRow[]> {
    const visits = await this.repository.findRankingVisits(organizationId, new Date(now.getTime() - RANKING_DAYS * DAY_MS));
    const names = await this.repository.findUserNames(visits.map((v) => v.sellerUserId));
    return buildRanking(visits, names);
  }

  listNumbers(organizationId: string): Promise<NumberRow[]> {
    return this.repository.listNumbers(organizationId);
  }

  addNumber(organizationId: string, phone: string, label: string, userId: string): Promise<NumberRow> {
    return this.repository.addNumber(organizationId, normalizePhone(phone), label.trim(), userId);
  }

  async removeNumber(organizationId: string, id: string): Promise<{ removed: true }> {
    if (!(await this.repository.removeNumber(organizationId, id))) throw new NotFoundException();
    return { removed: true };
  }

  private enqueue(visitId: string) {
    return this.queue.add(EVALUATE_JOB, { visitId }, evaluateJobOptions(visitId));
  }

  /** Avaliada: quem foi avaliado. Aberta: o dono atual da conversa. */
  private sellerIdOf(row: VisitRow): string | null {
    return row.sellerUserId ?? row.conversation.assignedToId;
  }

  private toListItem(row: VisitRow, names: Map<string, string>): VisitListItem {
    const sellerId = this.sellerIdOf(row);
    const lastInbound = row.conversation.lastInboundAt;
    return {
      id: row.id,
      status: row.status,
      scenario: row.scenario,
      sellerName: (sellerId && names.get(sellerId)) || null,
      totalScore: row.totalScore,
      createdAt: row.createdAt,
      closesAt:
        row.status === 'OPEN' && lastInbound ? new Date(lastInbound.getTime() + FOLLOW_UP_WINDOW_HOURS * HOUR_MS) : null,
      evaluatedAt: row.evaluatedAt,
      error: row.error,
    };
  }
}
