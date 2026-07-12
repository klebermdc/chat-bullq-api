import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import type {
  CreatePendingActionInput,
  PendingAction,
  PendingActionStatus,
} from './confirmation.types';
import { PendingActionStorage } from './pending-action.storage';
import { PENDING_ACTION_EXECUTOR_QUEUE } from './queue-names';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Service that owns the lifecycle of `PendingAction` records.
 *
 * Phase 1: pure CRUD + approve/reject + expiration check.
 * Phase 2: on `approve()` enqueue the actual tool execution (the args
 * are stored verbatim on the record).
 */
@Injectable()
export class PendingActionService {
  private readonly logger = new Logger(PendingActionService.name);
  private readonly DEFAULT_TTL_MIN = 30;

  constructor(
    private readonly storage: PendingActionStorage,
    @InjectQueue(PENDING_ACTION_EXECUTOR_QUEUE)
    private readonly executorQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /** Create a new PENDING action for human review. */
  async create(input: CreatePendingActionInput): Promise<PendingAction> {
    const now = new Date();
    const ttlMin = input.ttlMinutes ?? this.DEFAULT_TTL_MIN;
    const expiresAt = new Date(now.getTime() + ttlMin * 60 * 1000);

    const action: PendingAction = {
      id: randomUUID(),
      agentRunId: input.agentRunId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      toolName: input.toolName,
      args: input.args,
      preview: input.preview,
      status: 'PENDING',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.storage.save(action);

    this.logger.log({
      msg: 'pending_action_created',
      id: action.id,
      toolName: action.toolName,
      impact: action.preview.impact,
      conversationId: action.conversationId,
      expiresAt: action.expiresAt,
    });

    return action;
  }

  /**
   * Approve a pending action. If it has already expired in storage,
   * the status is moved to EXPIRED and the call fails.
   *
   * Phase 2 TODO: enqueue the actual execution of `action.toolName`
   * with `action.args` and persist `executionResult` once it runs.
   */
  async approve(id: string, userId: string): Promise<PendingAction> {
    const action = await this.storage.get(id);
    if (!action) throw new NotFoundException('Pending action not found');

    if (action.status !== 'PENDING') {
      throw new BadRequestException(
        `Action is ${action.status} and cannot be approved`,
      );
    }

    if (this.isExpired(action)) {
      const previous = action.status;
      action.status = 'EXPIRED';
      await this.storage.save(action, previous);
      throw new BadRequestException('Action expired');
    }

    const previous = action.status;
    action.status = 'APPROVED';
    action.approvedBy = userId;
    action.approvedAt = new Date().toISOString();
    await this.storage.save(action, previous);

    this.logger.log({
      msg: 'pending_action_approved',
      id,
      userId,
      toolName: action.toolName,
    });

    // Fase 2.5: enfileira execução real da tool. O processor
    // (PendingActionExecutorProcessor) resolve built-in vs HTTP skill,
    // executa com bypassPendingGate, salva executionResult e marca EXECUTED.
    try {
      await this.executorQueue.add(
        'execute_pending',
        { pendingActionId: id },
        { removeOnComplete: 100, removeOnFail: 50 },
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to enqueue executor for pending action ${id}: ${err?.message ?? err}`,
      );
      // Não rethrow — aprovação foi salva. Operador pode re-disparar via UI.
    }

    return action;
  }

  /**
   * Reject a pending action with a human-readable reason.
   */
  async reject(
    id: string,
    userId: string,
    reason: string,
  ): Promise<PendingAction> {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }

    const action = await this.storage.get(id);
    if (!action) throw new NotFoundException('Pending action not found');

    if (action.status !== 'PENDING') {
      throw new BadRequestException(
        `Action is ${action.status} and cannot be rejected`,
      );
    }

    if (this.isExpired(action)) {
      const previous = action.status;
      action.status = 'EXPIRED';
      await this.storage.save(action, previous);
      throw new BadRequestException('Action expired');
    }

    const previous = action.status;
    action.status = 'REJECTED';
    action.rejectedBy = userId;
    action.rejectedAt = new Date().toISOString();
    action.rejectedReason = reason.trim();
    await this.storage.save(action, previous);

    this.logger.log({
      msg: 'pending_action_rejected',
      id,
      userId,
      toolName: action.toolName,
    });

    return action;
  }

  /**
   * Distribui a conversa da pendência pra um atendente escolhido, sem passar
   * pelo "Aprovar" genérico. Efetiva na hora: pausa a IA, atribui a conversa
   * ao atendente (`assignedToId`) e move pra aba "Esperando"
   * (`awaitingHumanReply=true`), carregando o que o lead já mandou. Resolve a
   * pendência como EXECUTED. Usado pelo botão "Distribuir" no card de handoff.
   */
  async distribute(
    id: string,
    actorUserId: string,
    assignedToId: string,
  ): Promise<PendingAction> {
    if (!assignedToId || !assignedToId.trim()) {
      throw new BadRequestException('assignedToId é obrigatório');
    }

    const action = await this.storage.get(id);
    if (!action) throw new NotFoundException('Pending action not found');

    if (action.status !== 'PENDING') {
      throw new BadRequestException(
        `Action is ${action.status} and cannot be distributed`,
      );
    }
    if (this.isExpired(action)) {
      const previous = action.status;
      action.status = 'EXPIRED';
      await this.storage.save(action, previous);
      throw new BadRequestException('Action expired');
    }
    if (!action.conversationId) {
      throw new BadRequestException('Action has no conversation to distribute');
    }

    const conv = await this.prisma.conversation.findUnique({
      where: { id: action.conversationId },
      select: { status: true, firstResponseAt: true, organizationId: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    await this.prisma.conversation.update({
      where: { id: action.conversationId },
      data: {
        aiEnabled: false,
        assignedToId,
        awaitingHumanReply: true,
        // Promove PENDING→OPEN (conversa entrou em atendimento humano); mantém
        // o status quando já é outro. A aba "Esperando" é o flag acima.
        ...(conv.status === 'PENDING'
          ? { status: 'OPEN', firstResponseAt: conv.firstResponseAt ?? new Date() }
          : {}),
      },
    });

    // Automação pós-distribuição (best-effort — nunca quebra a distribuição):
    // (1) tag com o nome do atendente; (2) move o card do lead pra etapa
    // "Coletando informação" (o humano assume o atendimento a partir dali).
    try {
      await this.tagWithAttendant(action.conversationId, conv.organizationId, assignedToId);
    } catch (e) {
      this.logger.warn(`distribute: falha ao taguear atendente (conv=${action.conversationId}): ${(e as Error)?.message}`);
    }
    try {
      await this.advanceCardToColeta(action.conversationId, conv.organizationId);
    } catch (e) {
      this.logger.warn(`distribute: falha ao mover card p/ Coletando (conv=${action.conversationId}): ${(e as Error)?.message}`);
    }

    // NÃO resolve a pendência: ela fica VISÍVEL como "norte" pro atendente
    // escolhido até ele clicar Aprovar pra iniciar o atendimento (aí sim
    // vira EXECUTED via approve). Aqui só marca que foi distribuída, atualiza
    // o texto do card e estende o prazo pra não expirar antes de ele pegar.
    const attendant = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: { name: true },
    });
    const attendantName = attendant?.name ?? 'atendente';
    action.args = {
      ...action.args,
      distributedTo: assignedToId,
      distributedToName: attendant?.name ?? null,
      distributedBy: actorUserId,
      distributedAt: new Date().toISOString(),
    };
    action.preview = {
      ...action.preview,
      action: `Distribuído para ${attendantName} — o atendente clica "Aprovar" pra iniciar o atendimento.`,
    };
    // 7 dias de prazo pra o atendente pegar sem o card expirar.
    action.expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    // status continua PENDING → o card permanece na fila até o Aprovar.
    await this.storage.save(action, action.status);

    this.logger.log({
      msg: 'pending_action_distributed',
      id,
      actorUserId,
      assignedToId,
      conversationId: action.conversationId,
    });

    return action;
  }

  /** Aplica uma tag com o nome do atendente na conversa (cria a tag se não existir). */
  private async tagWithAttendant(
    conversationId: string,
    organizationId: string,
    assignedToId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: { name: true },
    });
    const name = (user?.name ?? '').trim();
    if (!name) return;

    const tag = await this.prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name },
      update: {},
      select: { id: true },
    });
    await this.prisma.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId, tagId: tag.id } },
      create: { conversationId, tagId: tag.id },
      update: {},
    });
  }

  /** Move o card do lead (pipeline "Vendas") pra etapa "Coletando informação". */
  private async advanceCardToColeta(
    conversationId: string,
    organizationId: string,
  ): Promise<void> {
    const card = await this.prisma.card.findFirst({
      where: {
        conversationId,
        organizationId,
        pipeline: { name: { contains: 'Vendas', mode: 'insensitive' } },
      },
      select: { id: true, pipelineId: true },
    });
    if (!card) return;

    const stage = await this.prisma.pipelineStage.findFirst({
      where: {
        pipelineId: card.pipelineId,
        name: { contains: 'oletando', mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!stage) return;

    const maxOrder = await this.prisma.card.aggregate({
      where: { stageId: stage.id },
      _max: { order: true },
    });
    await this.prisma.card.update({
      where: { id: card.id },
      data: { stageId: stage.id, order: (maxOrder._max.order ?? -1) + 1 },
    });
  }

  /** List PENDING actions, optionally filtered by conversation. */
  async listPending(conversationId?: string): Promise<PendingAction[]> {
    return this.storage.listByStatus('PENDING', conversationId);
  }

  /** List actions for a given status. */
  async listByStatus(
    status: PendingActionStatus,
    conversationId?: string,
  ): Promise<PendingAction[]> {
    return this.storage.listByStatus(status, conversationId);
  }

  /** List every action (any status) for a conversation. */
  async listForConversation(conversationId: string): Promise<PendingAction[]> {
    return this.storage.listByConversation(conversationId);
  }

  async get(id: string): Promise<PendingAction | null> {
    return this.storage.get(id);
  }

  /**
   * Check & sweep expirations.
   *
   * Walks every PENDING action, marks expired ones as EXPIRED, returns
   * the count moved. Cron-friendly (idempotent). Phase 2 will wire this
   * to a `@Cron('* * * * *')` runner.
   */
  async expireOverdue(): Promise<number> {
    const pending = await this.storage.listByStatus('PENDING');
    let moved = 0;
    for (const action of pending) {
      if (this.isExpired(action)) {
        const previous = action.status;
        action.status = 'EXPIRED';
        await this.storage.save(action, previous);
        moved++;
        this.logger.log({
          msg: 'pending_action_expired',
          id: action.id,
          toolName: action.toolName,
        });
      }
    }
    return moved;
  }

  private isExpired(action: PendingAction): boolean {
    return new Date(action.expiresAt).getTime() < Date.now();
  }
}
