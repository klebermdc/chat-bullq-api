import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import type {
  ActionPreview,
  PendingAction,
  PendingActionStatus,
} from './confirmation.types';

/**
 * Prisma-backed storage for `PendingAction` records (Fase 2).
 *
 * Substitui o storage Redis interim. Mantém a mesma interface pública
 * (save/get/listByStatus/listByConversation) — service e controller
 * continuam funcionando sem mudança.
 */
@Injectable()
export class PendingActionStorage {
  private readonly logger = new Logger(PendingActionStorage.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(
    action: PendingAction,
    _previousStatus?: PendingActionStatus,
  ): Promise<void> {
    // Campos que mudam ao longo do ciclo de vida da ação. Precisam ser
    // idênticos no create e no update — senão um caminho como distribute()
    // (que altera args/preview/expiresAt mantendo o status PENDING) grava só
    // no create e é silenciosamente ignorado no update, e o estado
    // "distribuído" se perde (o botão "Distribuir" nunca some do card).
    // Mantê-los num só objeto elimina a classe inteira dessa divergência.
    const mutableFields = {
      status: action.status,
      args: action.args as Prisma.InputJsonValue,
      preview: action.preview as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(action.expiresAt),
      approvedBy: action.approvedBy ?? null,
      approvedAt: action.approvedAt ? new Date(action.approvedAt) : null,
      rejectedBy: action.rejectedBy ?? null,
      rejectedAt: action.rejectedAt ? new Date(action.rejectedAt) : null,
      rejectedReason: action.rejectedReason ?? null,
      executionResult:
        (action.executionResult as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    };

    await this.prisma.aiPendingAction.upsert({
      where: { id: action.id },
      create: {
        id: action.id,
        organizationId: action.organizationId,
        agentRunId: action.agentRunId,
        conversationId: action.conversationId,
        agentId: action.agentId,
        toolName: action.toolName,
        ...mutableFields,
      },
      update: mutableFields,
    });
  }

  async get(
    id: string,
    organizationId: string,
  ): Promise<PendingAction | null> {
    // findFirst, NÃO findUnique: findUnique só aceita campo único no `where`,
    // então não dá pra somar a organização — e era exatamente por isso que
    // approve/reject/distribute alcançavam a ação de outra empresa pelo id.
    const row = await this.prisma.aiPendingAction.findFirst({
      where: { id, organizationId },
    });
    return row ? this.toDomain(row) : null;
  }

  async listByStatus(
    status: PendingActionStatus,
    organizationId: string,
    conversationId?: string,
  ): Promise<PendingAction[]> {
    const rows = await this.prisma.aiPendingAction.findMany({
      where: {
        status,
        organizationId,
        ...(conversationId ? { conversationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async listByConversation(
    conversationId: string,
    organizationId: string,
  ): Promise<PendingAction[]> {
    const rows = await this.prisma.aiPendingAction.findMany({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  /**
   * Varredura de expiração, atravessando TODAS as organizações.
   *
   * É o único caminho de leitura sem escopo, e o nome diz isso na cara de
   * propósito: quem chamar sem ser o cron está lendo dado de outra empresa.
   * Só o `expireOverdue()` usa.
   */
  async listPendingAllOrgs(): Promise<PendingAction[]> {
    const rows = await this.prisma.aiPendingAction.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: {
    id: string;
    organizationId: string | null;
    agentRunId: string;
    conversationId: string;
    agentId: string;
    toolName: string;
    args: Prisma.JsonValue;
    preview: Prisma.JsonValue;
    status: PendingActionStatus;
    expiresAt: Date;
    approvedBy: string | null;
    approvedAt: Date | null;
    rejectedBy: string | null;
    rejectedAt: Date | null;
    rejectedReason: string | null;
    executionResult: Prisma.JsonValue | null;
    createdAt: Date;
  }): PendingAction {
    return {
      id: row.id,
      organizationId: row.organizationId,
      agentRunId: row.agentRunId,
      conversationId: row.conversationId,
      agentId: row.agentId,
      toolName: row.toolName,
      args: (row.args ?? {}) as Record<string, unknown>,
      preview: row.preview as unknown as ActionPreview,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      approvedBy: row.approvedBy ?? undefined,
      approvedAt: row.approvedAt?.toISOString(),
      rejectedBy: row.rejectedBy ?? undefined,
      rejectedAt: row.rejectedAt?.toISOString(),
      rejectedReason: row.rejectedReason ?? undefined,
      executionResult: row.executionResult ?? undefined,
    };
  }
}
