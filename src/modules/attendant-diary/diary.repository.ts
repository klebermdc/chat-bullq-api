import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';
import {
  DEFAULT_DIARY_TIMEZONE,
  MAX_CONTEXT_MESSAGES,
  NON_CONVERSATIONAL_TYPES,
} from './diary.constants';
import type {
  DiaryDetails,
  DiaryMessage,
  DiaryMetrics,
  DiaryPoint,
  DiaryStatus,
} from './diary.types';

const LIST_LIMIT = 60;
export const UNKNOWN_CONTACT = 'Cliente';

const MESSAGE_SELECT = {
  conversationId: true,
  direction: true,
  senderId: true,
  content: true,
  createdAt: true,
} satisfies Prisma.MessageSelect;

/** O que o atendente vê: sem custo, erro técnico ou dados de auditoria. */
const PUBLIC_SELECT = {
  id: true,
  userId: true,
  day: true,
  status: true,
  metrics: true,
  summary: true,
  strengths: true,
  improvements: true,
  details: true,
  viewedAt: true,
} satisfies Prisma.AttendantDiarySelect;

const CONVERSATIONAL = { type: { notIn: [...NON_CONVERSATIONAL_TYPES] } } satisfies Prisma.MessageWhereInput;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

export interface DiaryMember {
  name: string;
  workingHours: BusinessHoursConfig | null;
  timeZone: string;
}

export interface DiaryParticipant {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  timeZone: string;
}

export interface DiaryRecord {
  organizationId: string;
  userId: string;
  day: string;
  status: DiaryStatus;
  metrics: DiaryMetrics & { onlineMinutes: number };
  summary?: string;
  strengths?: DiaryPoint[];
  improvements?: DiaryPoint[];
  details?: Partial<DiaryDetails>;
  conversationsAnalyzed: number;
  discardedPoints?: number;
  criteriaVersions?: Record<string, number>;
  modelId?: string;
  costUsd?: number;
  errorMessage?: string;
}

const toDbDay = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** Corpo textual de `Message.content`, que varia por tipo e provedor. */
function extractText(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const c = content as Record<string, unknown>;
  const text = c.text ?? c.body ?? c.caption;
  return typeof text === 'string' ? text : '';
}

function toDiaryMessage(row: MessageRow): DiaryMessage {
  return {
    conversationId: row.conversationId,
    direction: row.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
    senderId: row.senderId,
    text: extractText(row.content),
    at: row.createdAt,
  };
}

@Injectable()
export class DiaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDiary(organizationId: string, userId: string, day: string) {
    return this.prisma.attendantDiary.findUnique({
      where: {
        uq_diary_org_user_day: { organizationId, userId, day: toDbDay(day) },
      },
      select: { status: true },
    });
  }

  async findMember(organizationId: string, userId: string): Promise<DiaryMember | null> {
    const member = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        workingHours: true,
        user: { select: { name: true } },
        organization: { select: { aiTimezone: true } },
      },
    });
    if (!member) return null;
    return {
      name: member.user.name,
      workingHours: (member.workingHours ?? null) as BusinessHoursConfig | null,
      timeZone: member.organization.aiTimezone ?? DEFAULT_DIARY_TIMEZONE,
    };
  }

  async findParticipants(emails: string[]): Promise<DiaryParticipant[]> {
    if (emails.length === 0) return [];
    const members = await this.prisma.userOrganization.findMany({
      where: {
        user: {
          email: { in: emails, mode: 'insensitive' },
          isActive: true,
          deletedAt: null,
        },
      },
      select: {
        organizationId: true,
        userId: true,
        user: { select: { name: true, email: true } },
        organization: { select: { aiTimezone: true } },
      },
    });
    return members.map((m) => ({
      organizationId: m.organizationId,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      timeZone: m.organization.aiTimezone ?? DEFAULT_DIARY_TIMEZONE,
    }));
  }

  /** Mensagens do dia nas conversas em que o atendente falou ou é o dono. */
  async findDayMessages(
    organizationId: string,
    userId: string,
    range: { from: Date; to: Date },
  ): Promise<DiaryMessage[]> {
    const createdAt = { gte: range.from, lt: range.to };
    const touched = await this.prisma.message.findMany({
      where: {
        ...CONVERSATIONAL,
        createdAt,
        conversation: { organizationId },
        OR: [{ senderId: userId }, { conversation: { assignedToId: userId } }],
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    });
    if (touched.length === 0) return [];

    const rows = await this.prisma.message.findMany({
      where: {
        ...CONVERSATIONAL,
        createdAt,
        revokedAt: null,
        conversationId: { in: touched.map((t) => t.conversationId) },
      },
      orderBy: { createdAt: 'asc' },
      select: MESSAGE_SELECT,
    });
    return rows.map(toDiaryMessage);
  }

  /** Últimas mensagens antes do dia, para a IA entender a conversa. */
  async findContextMessages(conversationIds: string[], before: Date): Promise<DiaryMessage[]> {
    const groups = await Promise.all(
      conversationIds.map((conversationId) =>
        this.prisma.message.findMany({
          where: { ...CONVERSATIONAL, conversationId, createdAt: { lt: before }, revokedAt: null },
          orderBy: { createdAt: 'desc' },
          take: MAX_CONTEXT_MESSAGES,
          select: MESSAGE_SELECT,
        }),
      ),
    );
    return groups.flatMap((rows) => [...rows].reverse().map(toDiaryMessage));
  }

  /** Nome do cliente de cada conversa, para o diário não mostrar só um código. */
  async findContactNames(conversationIds: string[]): Promise<Map<string, string>> {
    if (conversationIds.length === 0) return new Map();
    const conversations = await this.prisma.conversation.findMany({
      where: { id: { in: conversationIds } },
      select: { id: true, contact: { select: { name: true } } },
    });
    return new Map(
      conversations.map((c) => [c.id, c.contact?.name?.trim() || UNKNOWN_CONTACT]),
    );
  }

  async findOnlineMinutes(organizationId: string, userId: string, day: string): Promise<number> {
    const presence = await this.prisma.agentPresenceDaily.findUnique({
      where: {
        organizationId_userId_day: { organizationId, userId, day: toDbDay(day) },
      },
      select: { onlineMinutes: true },
    });
    return presence?.onlineMinutes ?? 0;
  }

  async saveDiary(record: DiaryRecord): Promise<void> {
    const { organizationId, userId, day, ...fields } = record;
    const data = {
      status: fields.status,
      metrics: fields.metrics as unknown as Prisma.InputJsonValue,
      summary: fields.summary ?? null,
      strengths: (fields.strengths ?? []) as unknown as Prisma.InputJsonValue,
      improvements: (fields.improvements ?? []) as unknown as Prisma.InputJsonValue,
      details: (fields.details ?? {}) as unknown as Prisma.InputJsonValue,
      conversationsAnalyzed: fields.conversationsAnalyzed,
      discardedPoints: fields.discardedPoints ?? 0,
      criteriaVersions: fields.criteriaVersions ?? {},
      modelId: fields.modelId ?? null,
      costUsd: fields.costUsd ?? 0,
      errorMessage: fields.errorMessage ?? null,
    };
    const dbDay = toDbDay(day);
    await this.prisma.attendantDiary.upsert({
      where: { uq_diary_org_user_day: { organizationId, userId, day: dbDay } },
      create: { organizationId, userId, day: dbDay, ...data },
      update: { ...data, viewedAt: null },
    });
  }

  /**
   * Gerar de novo e falhar não pode apagar um diário bom: só registra o erro e
   * o custo da tentativa, para o gestor ver no painel.
   */
  async recordFailure(record: {
    organizationId: string;
    userId: string;
    day: string;
    errorMessage: string;
    costUsd: number;
  }): Promise<void> {
    const { organizationId, userId, day, errorMessage, costUsd } = record;
    await this.prisma.attendantDiary.update({
      where: { uq_diary_org_user_day: { organizationId, userId, day: toDbDay(day) } },
      data: { errorMessage, costUsd: { increment: costUsd } },
    });
  }

  /** Diário mais recente pronto do atendente, ou o de um dia específico. */
  findForUser(organizationId: string, userId: string, day?: string) {
    return this.prisma.attendantDiary.findFirst({
      where: {
        organizationId,
        userId,
        status: 'READY',
        ...(day ? { day: toDbDay(day) } : {}),
      },
      orderBy: { day: 'desc' },
      select: PUBLIC_SELECT,
    });
  }

  listForManagers(organizationId: string, userId?: string) {
    return this.prisma.attendantDiary.findMany({
      where: { organizationId, ...(userId ? { userId } : {}) },
      orderBy: [{ day: 'desc' }, { userId: 'asc' }],
      take: LIST_LIMIT,
      select: {
        ...PUBLIC_SELECT,
        conversationsAnalyzed: true,
        discardedPoints: true,
        costUsd: true,
        errorMessage: true,
      },
    });
  }

  /** Só o próprio atendente marca: o gestor abrir não conta como leitura. */
  async markViewed(organizationId: string, userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.attendantDiary.updateMany({
      where: { id, organizationId, userId, viewedAt: null },
      data: { viewedAt: new Date() },
    });
    return count > 0;
  }
}
