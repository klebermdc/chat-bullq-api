import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  FOLLOW_UP_AFTER_HOURS,
  FOLLOW_UP_UNTIL_DAYS,
  PLAN_ITEMS_PER_SECTION,
  STALLED_CARD_DAYS,
} from './diary.constants';
import { UNKNOWN_CONTACT } from './diary.repository';
import type {
  FlightPlan,
  FlightPlanCard,
  FlightPlanConversation,
  FlightPlanScheduled,
  FlightPlanSection,
} from './diary.types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const CONTACT = { select: { name: true } } as const;

const nameOf = (contact: { name: string | null } | null): string =>
  contact?.name?.trim() || UNKNOWN_CONTACT;

/** Conversas que ainda são do atendente: abertas, visíveis e sem grupo. */
const myConversations = (organizationId: string, userId: string) =>
  ({
    organizationId,
    assignedToId: userId,
    deletedAt: null,
    isArchived: false,
    isGroup: false,
    status: { not: 'CLOSED' },
  }) satisfies Prisma.ConversationWhereInput;

async function section<T, R>(
  count: () => Promise<number>,
  find: () => Promise<R[]>,
  toItem: (row: R) => T,
): Promise<FlightPlanSection<T>> {
  const [total, rows] = await Promise.all([count(), find()]);
  return { total, items: rows.map(toItem) };
}

/** Consultas do plano de voo: só leitura, nada aqui chama a IA. */
@Injectable()
export class FlightPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    organizationId: string,
    userId: string,
    now: Date,
    today: { from: Date; to: Date },
  ): Promise<FlightPlan> {
    const [replyNow, followUp, stalledCards, scheduledToday] = await Promise.all([
      this.replyNow(organizationId, userId),
      this.followUp(organizationId, userId, now),
      this.stalledCards(organizationId, userId, now),
      this.scheduledToday(organizationId, userId, today),
    ]);
    return { generatedAt: now.toISOString(), replyNow, followUp, stalledCards, scheduledToday };
  }

  /** Cliente esperando resposta de gente, quem espera há mais tempo primeiro. */
  private replyNow(organizationId: string, userId: string) {
    const where = {
      ...myConversations(organizationId, userId),
      awaitingHumanReply: true,
      lastInboundAt: { not: null },
    } satisfies Prisma.ConversationWhereInput;
    return section<FlightPlanConversation, { id: string; lastInboundAt: Date | null; contact: { name: string | null } | null }>(
      () => this.prisma.conversation.count({ where }),
      () =>
        this.prisma.conversation.findMany({
          where,
          orderBy: { lastInboundAt: 'asc' },
          take: PLAN_ITEMS_PER_SECTION,
          select: { id: true, lastInboundAt: true, contact: CONTACT },
        }),
      (row) => ({
        conversationId: row.id,
        contactName: nameOf(row.contact),
        since: (row.lastInboundAt as Date).toISOString(),
      }),
    );
  }

  /**
   * A última fala foi nossa e o cliente sumiu. Fica de fora quem já tem
   * retomada agendada ou foi marcado como venda perdida.
   */
  private followUp(organizationId: string, userId: string, now: Date) {
    const where = {
      ...myConversations(organizationId, userId),
      awaitingHumanReply: false,
      lostAt: null,
      lastOutboundAt: {
        gte: new Date(now.getTime() - FOLLOW_UP_UNTIL_DAYS * DAY_MS),
        lte: new Date(now.getTime() - FOLLOW_UP_AFTER_HOURS * HOUR_MS),
      },
      scheduledMessages: { none: { status: 'PENDING' } },
    } satisfies Prisma.ConversationWhereInput;
    return section<FlightPlanConversation, { id: string; lastOutboundAt: Date | null; contact: { name: string | null } | null }>(
      () => this.prisma.conversation.count({ where }),
      () =>
        this.prisma.conversation.findMany({
          where,
          orderBy: { lastOutboundAt: 'asc' },
          take: PLAN_ITEMS_PER_SECTION,
          select: { id: true, lastOutboundAt: true, contact: CONTACT },
        }),
      (row) => ({
        conversationId: row.id,
        contactName: nameOf(row.contact),
        since: (row.lastOutboundAt as Date).toISOString(),
      }),
    );
  }

  private stalledCards(organizationId: string, userId: string, now: Date) {
    const where = {
      organizationId,
      assignedToId: userId,
      status: 'OPEN',
      updatedAt: { lte: new Date(now.getTime() - STALLED_CARD_DAYS * DAY_MS) },
      pipeline: { archived: false },
      stage: { type: 'NORMAL' },
    } satisfies Prisma.CardWhereInput;
    const select = {
      id: true,
      title: true,
      value: true,
      updatedAt: true,
      pipelineId: true,
      conversationId: true,
      pipeline: { select: { name: true } },
      stage: { select: { name: true } },
      contact: CONTACT,
    } satisfies Prisma.CardSelect;
    return section<FlightPlanCard, Prisma.CardGetPayload<{ select: typeof select }>>(
      () => this.prisma.card.count({ where }),
      () =>
        this.prisma.card.findMany({
          where,
          orderBy: { updatedAt: 'asc' },
          take: PLAN_ITEMS_PER_SECTION,
          select,
        }),
      (row) => ({
        cardId: row.id,
        pipelineId: row.pipelineId,
        conversationId: row.conversationId,
        title: row.title,
        contactName: nameOf(row.contact),
        pipelineName: row.pipeline.name,
        stageName: row.stage.name,
        value: row.value ? row.value.toNumber() : null,
        since: row.updatedAt.toISOString(),
      }),
    );
  }

  private scheduledToday(
    organizationId: string,
    userId: string,
    today: { from: Date; to: Date },
  ) {
    const where = {
      organizationId,
      status: 'PENDING',
      scheduledAt: { gte: today.from, lt: today.to },
      conversation: { assignedToId: userId, deletedAt: null },
    } satisfies Prisma.ScheduledMessageWhereInput;
    const select = {
      conversationId: true,
      scheduledAt: true,
      origin: true,
      contact: CONTACT,
    } satisfies Prisma.ScheduledMessageSelect;
    return section<FlightPlanScheduled, Prisma.ScheduledMessageGetPayload<{ select: typeof select }>>(
      () => this.prisma.scheduledMessage.count({ where }),
      () =>
        this.prisma.scheduledMessage.findMany({
          where,
          orderBy: { scheduledAt: 'asc' },
          take: PLAN_ITEMS_PER_SECTION,
          select,
        }),
      (row) => ({
        conversationId: row.conversationId,
        contactName: nameOf(row.contact),
        at: row.scheduledAt.toISOString(),
        origin: row.origin,
      }),
    );
  }
}
