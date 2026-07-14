import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CardStatus, PipelineStageType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CadenceRunner } from '../cadences/cadence-runner.service';
import {
  CreateCardDto,
  CreatePipelineDto,
  MoveCardDto,
  UpdateCardDto,
  UpdatePipelineDto,
  UpsertStageDto,
} from './dto/pipeline.dto';

/** E6 — nome (contains) da etapa final de entrega. Não colide com "Proposta enviada". */
const ORDER_SENT_STAGE_NAME = 'Pedido enviado';

/**
 * Dada a lista de propostas de um board, devolve um mapa
 * `contactId -> startDate (ISO)` da proposta MAIS RECENTE (por createdAt) de
 * cada contato. Alimenta o filtro "mês da viagem" no Kanban.
 */
export function latestTravelStartByContact(
  proposals: { contactId: string; startDate: Date; createdAt: Date }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const seenAt: Record<string, number> = {};
  for (const p of proposals) {
    const t = p.createdAt.getTime();
    if (seenAt[p.contactId] === undefined || t > seenAt[p.contactId]) {
      seenAt[p.contactId] = t;
      out[p.contactId] = p.startDate.toISOString();
    }
  }
  return out;
}

const DEFAULT_STAGES: UpsertStageDto[] = [
  { name: 'Novo', color: 'zinc', type: 'NORMAL', order: 0 },
  { name: 'Em qualificação', color: 'blue', type: 'NORMAL', order: 1 },
  { name: 'Proposta', color: 'amber', type: 'NORMAL', order: 2 },
  { name: 'Ganho', color: 'green', type: 'WON', order: 3 },
  { name: 'Perdido', color: 'red', type: 'LOST', order: 4 },
];

@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @Inject(forwardRef(() => CadenceRunner))
    private readonly cadenceRunner: CadenceRunner,
  ) {}

  // ─── Pipelines ─────────────────────────────────

  async listPipelines(organizationId: string) {
    return this.prisma.pipeline.findMany({
      where: { organizationId, archived: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        stages: { orderBy: { order: 'asc' } },
        _count: { select: { cards: true } },
      },
    });
  }

  async getBoard(pipelineId: string, organizationId: string) {
    const pipeline = await this.assertPipeline(pipelineId, organizationId);
    const [stages, cards] = await this.prisma.$transaction([
      this.prisma.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      }),
      this.prisma.card.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
        include: {
          contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
          assignedTo: { select: { id: true, name: true, avatarUrl: true } },
          // Channel comes via the linked conversation — the kanban card UI
          // surfaces the icon (Zappfy/Meta/Instagram) so the operator can
          // tell at a glance where the conversation lives without opening it.
          conversation: {
            select: {
              id: true,
              channelId: true,
              temperature: true,
              // Atendente que atende a conversa (o "responsável" real do lead).
              // O card.assignedTo é a atribuição do card no pipeline, que
              // costuma ficar vazia — a UI prefere este.
              assignedTo: { select: { id: true, name: true, avatarUrl: true } },
              channel: { select: { id: true, type: true, name: true } },
            },
          },
        },
      }),
    ]);

    const cardsByStage: Record<string, typeof cards> = {};
    for (const s of stages) cardsByStage[s.id] = [];
    for (const c of cards) {
      (cardsByStage[c.stageId] ||= []).push(c);
    }

    return { pipeline, stages, cards: cardsByStage };
  }

  async createPipeline(organizationId: string, dto: CreatePipelineDto) {
    const stagesIn = dto.stages?.length ? dto.stages : DEFAULT_STAGES;

    const max = await this.prisma.pipeline.findFirst({
      where: { organizationId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (max?.order ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      // Only one default per org — if requested, demote the others.
      if (dto.isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const pipeline = await tx.pipeline.create({
        data: {
          organizationId,
          name: dto.name,
          description: dto.description,
          icon: dto.icon,
          color: dto.color,
          isDefault: dto.isDefault ?? false,
          order: nextOrder,
          stages: {
            create: stagesIn.map((s, i) => ({
              name: s.name,
              color: s.color,
              type: (s.type ?? 'NORMAL') as PipelineStageType,
              order: s.order ?? i,
            })),
          },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });

      return pipeline;
    });
  }

  async updatePipeline(
    id: string,
    organizationId: string,
    dto: UpdatePipelineDto,
  ) {
    await this.assertPipeline(id, organizationId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.archived !== undefined ? { archived: dto.archived } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
    });
  }

  async removePipeline(id: string, organizationId: string) {
    await this.assertPipeline(id, organizationId);
    await this.prisma.pipeline.delete({ where: { id } });
  }

  // ─── Stages ────────────────────────────────────

  async upsertStages(
    pipelineId: string,
    organizationId: string,
    stages: UpsertStageDto[],
  ) {
    await this.assertPipeline(pipelineId, organizationId);

    return this.prisma.$transaction(async (tx) => {
      // Existing ids that still appear in the new list — keep them.
      const keepIds = new Set(stages.filter((s) => s.id).map((s) => s.id!));

      // Delete stages that disappeared. If they have cards, refuse — operator
      // must move/close cards first.
      const orphans = await tx.pipelineStage.findMany({
        where: {
          pipelineId,
          ...(keepIds.size > 0 ? { id: { notIn: Array.from(keepIds) } } : {}),
        },
        include: { _count: { select: { cards: true } } },
      });
      for (const o of orphans) {
        if (o._count.cards > 0) {
          throw new BadRequestException(
            `Stage "${o.name}" tem cards e não pode ser deletada — mova-os primeiro.`,
          );
        }
      }
      if (orphans.length > 0) {
        await tx.pipelineStage.deleteMany({
          where: { id: { in: orphans.map((o) => o.id) } },
        });
      }

      // Upsert each remaining stage.
      const upserts = stages.map((s, i) => {
        const data = {
          name: s.name,
          color: s.color ?? null,
          type: (s.type ?? 'NORMAL') as PipelineStageType,
          order: s.order ?? i,
        };
        return s.id
          ? tx.pipelineStage.update({ where: { id: s.id }, data })
          : tx.pipelineStage.create({
              data: { pipelineId, ...data },
            });
      });
      await Promise.all(upserts);

      return tx.pipelineStage.findMany({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      });
    });
  }

  // ─── Cards ─────────────────────────────────────

  async createCard(
    pipelineId: string,
    organizationId: string,
    dto: CreateCardDto,
  ) {
    await this.assertPipeline(pipelineId, organizationId);

    // Cards represent conversations entering the pipeline. If the same
    // conversation is already in this pipeline (any stage), reject — the
    // operator should move/edit the existing card instead of duplicating.
    if (dto.conversationId) {
      const existing = await this.prisma.card.findFirst({
        where: { pipelineId, conversationId: dto.conversationId },
        select: { id: true, stageId: true },
      });
      if (existing) {
        throw new BadRequestException(
          `Essa conversa já está no pipeline (card ${existing.id}). Mova-o em vez de duplicar.`,
        );
      }
    }

    // If conversationId provided, hydrate title/contactId from the conv
    // so the operator doesn't need to retype the contact name.
    if (dto.conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: dto.conversationId },
        select: {
          id: true,
          organizationId: true,
          contactId: true,
          contact: { select: { name: true, phone: true } },
        },
      });
      if (!conv || conv.organizationId !== organizationId) {
        throw new BadRequestException('conversationId inválido');
      }
      if (!dto.title?.trim()) {
        dto.title = conv.contact.name || conv.contact.phone || 'Sem nome';
      }
      if (!dto.contactId) {
        dto.contactId = conv.contactId;
      }
    }

    // Resolve stage: explicit → use it; else first stage of the pipeline.
    let stageId = dto.stageId;
    if (!stageId) {
      const first = await this.prisma.pipelineStage.findFirst({
        where: { pipelineId },
        orderBy: { order: 'asc' },
      });
      if (!first) throw new BadRequestException('Pipeline sem stages');
      stageId = first.id;
    } else {
      const stage = await this.prisma.pipelineStage.findUnique({
        where: { id: stageId },
      });
      if (!stage || stage.pipelineId !== pipelineId) {
        throw new BadRequestException('stageId inválido pra esse pipeline');
      }
    }

    const max = await this.prisma.card.findFirst({
      where: { pipelineId, stageId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (max?.order ?? -1) + 1;

    if (!dto.title?.trim()) {
      throw new BadRequestException(
        'title é obrigatório (ou vincule uma conversationId pra derivar)',
      );
    }

    const card = await this.prisma.card.create({
      data: {
        organizationId,
        pipelineId,
        stageId,
        title: dto.title!,
        description: dto.description,
        value: dto.value as any,
        currency: dto.currency ?? 'BRL',
        contactId: dto.contactId ?? null,
        conversationId: dto.conversationId ?? null,
        assignedToId: dto.assignedToId ?? null,
        order: nextOrder,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    this.realtime.emitToOrg(organizationId, 'card:created', { card });
    return card;
  }

  /**
   * Garante que a conversa esteja num card no estágio de nome `stageName`
   * (ex.: "PROPOSTA ENVIADA"). Cria o card se a conversa ainda não tem um no
   * pipeline; avança se está numa etapa anterior; NÃO puxa pra trás nem mexe em
   * card ganho/perdido. Dispara a cadência ao criar/avançar. Atualiza o valor do
   * card com o da proposta. Usado quando uma proposta é enviada — best-effort.
   * No-op silencioso se não existir etapa com esse nome na org.
   */
  async ensureConversationAtStageByName(
    organizationId: string,
    conversationId: string,
    stageName: string,
    opts: { value?: number; currency?: string } = {},
  ): Promise<void> {
    const targetStage = await this.prisma.pipelineStage.findFirst({
      where: {
        name: { equals: stageName, mode: 'insensitive' },
        pipeline: { organizationId },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!targetStage) return;

    const value = opts.value != null ? (opts.value as any) : undefined;
    const currency = opts.currency ?? 'BRL';

    const existing = await this.prisma.card.findFirst({
      where: { pipelineId: targetStage.pipelineId, conversationId },
      include: { stage: { select: { order: true } } },
    });

    if (!existing) {
      const card = await this.createCard(targetStage.pipelineId, organizationId, {
        conversationId,
        stageId: targetStage.id,
        value,
        currency,
      } as any);
      // createCard não dispara cadência — disparamos aqui (igual o moveCard faz).
      this.cadenceRunner
        .maybeStartForStage(conversationId, card.id, targetStage.id, organizationId)
        .catch((err) =>
          this.logger.warn(
            `cadence_maybeStartForStage_failed card=${card.id}: ${(err as Error).message}`,
          ),
        );
      return;
    }

    // Não mexe em negócio já ganho/perdido.
    if (existing.status !== 'OPEN') return;

    // Só avança: se está numa etapa anterior, move (moveCard dispara a cadência).
    if (existing.stage.order < targetStage.order) {
      await this.moveCard(existing.id, organizationId, {
        toStageId: targetStage.id,
        toIndex: 0,
      } as any);
    }

    // Mantém o valor do card em dia com a proposta (mesmo sem trocar de etapa).
    if (value !== undefined) {
      await this.prisma.card.update({
        where: { id: existing.id },
        data: { value, currency },
      });
    }
  }

  /**
   * E6 — Entrega: marca o pedido como enviado, movendo o card da conversa pra
   * etapa final do funil (default "Pedido enviado"). Diferente de
   * `ensureConversationAtStageByName`, a entrega é PÓS-fechamento (o card já
   * pode estar ganho/WON) — por isso move via `moveCard` sem a guarda de
   * "só OPEN". Por decisão de projeto é só ETAPA, sem tag redundante.
   *
   * Resolve a etapa por nome (contains, case-insensitive) — "Pedido enviado"
   * não colide com "Proposta enviada". Lança se a etapa não existir na org ou
   * se a conversa não tiver card no funil.
   */
  async markOrderSentForConversation(
    organizationId: string,
    conversationId: string,
    stageName: string = ORDER_SENT_STAGE_NAME,
  ) {
    const targetStage = await this.prisma.pipelineStage.findFirst({
      where: {
        name: { contains: stageName, mode: 'insensitive' },
        pipeline: { organizationId },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!targetStage) {
      throw new BadRequestException(
        `Etapa "${stageName}" não existe no funil desta organização.`,
      );
    }

    const card = await this.prisma.card.findFirst({
      where: { pipelineId: targetStage.pipelineId, conversationId },
    });
    if (!card) {
      throw new BadRequestException(
        'Este lead ainda não tem card no funil de vendas.',
      );
    }

    return this.moveCard(card.id, organizationId, {
      toStageId: targetStage.id,
      toIndex: 0,
    } as MoveCardDto);
  }

  /**
   * E5.1 — Fechamento: marca o negócio como Ganho. Guarda o nº do pedido no
   * card (chave de correlação futura com o HUB — `OfpSalesOrder.pedido`, fatia
   * E5.2) em `metadata.orderNumber` e move o card pra a etapa Ganho (type WON)
   * do funil da conversa. O `moveCard` já seta status=WON + closedAt.
   *
   * nº do pedido é opcional (o atendente pode não tê-lo ainda) — sem ele, só
   * move pra WON. Lança se a conversa não tem card ou o funil não tem etapa WON.
   */
  async markWonForConversation(
    organizationId: string,
    conversationId: string,
    orderNumber?: string,
  ) {
    const card = await this.prisma.card.findFirst({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
    });
    if (!card) {
      throw new BadRequestException(
        'Este lead ainda não tem card no funil de vendas.',
      );
    }

    const wonStage = await this.prisma.pipelineStage.findFirst({
      where: { pipelineId: card.pipelineId, type: 'WON' },
      orderBy: { order: 'asc' },
    });
    if (!wonStage) {
      throw new BadRequestException(
        'O funil não tem etapa de Ganho (tipo WON).',
      );
    }

    const trimmed = orderNumber?.trim();
    if (trimmed) {
      await this.prisma.card.update({
        where: { id: card.id },
        data: {
          metadata: {
            ...((card.metadata as Record<string, unknown>) ?? {}),
            orderNumber: trimmed,
          },
        },
      });
    }

    return this.moveCard(card.id, organizationId, {
      toStageId: wonStage.id,
      toIndex: 0,
    } as MoveCardDto);
  }

  async updateCard(
    cardId: string,
    organizationId: string,
    dto: UpdateCardDto,
  ) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }

    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.value !== undefined ? { value: dto.value as any } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.contactId !== undefined
          ? { contactId: dto.contactId }
          : {}),
        ...(dto.conversationId !== undefined
          ? { conversationId: dto.conversationId }
          : {}),
        ...(dto.assignedToId !== undefined
          ? { assignedToId: dto.assignedToId }
          : {}),
        ...(dto.closedReason !== undefined
          ? { closedReason: dto.closedReason }
          : {}),
      },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    this.realtime.emitToOrg(organizationId, 'card:updated', { card: updated });
    return updated;
  }

  async removeCard(cardId: string, organizationId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }
    await this.prisma.card.delete({ where: { id: cardId } });
    this.realtime.emitToOrg(organizationId, 'card:deleted', {
      cardId,
      pipelineId: card.pipelineId,
    });
  }

  /**
   * Atomic drag-drop: pulls the card out of its source stage, shifts the
   * other source siblings up, makes room in the target stage at toIndex,
   * inserts the card. Updates `status` + `closedAt` if the target stage
   * is a WON/LOST terminal.
   */
  async moveCard(
    cardId: string,
    organizationId: string,
    dto: MoveCardDto,
  ) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card || card.organizationId !== organizationId) {
      throw new NotFoundException('Card not found');
    }
    const targetStage = await this.prisma.pipelineStage.findUnique({
      where: { id: dto.toStageId },
    });
    if (!targetStage || targetStage.pipelineId !== card.pipelineId) {
      throw new BadRequestException('toStageId fora desse pipeline');
    }

    const fromStageId = card.stageId;
    const fromIndex = card.order;
    const sameStage = fromStageId === dto.toStageId;

    let newStatus: CardStatus = card.status;
    let newClosedAt = card.closedAt;
    if (targetStage.type === 'WON') {
      newStatus = CardStatus.WON;
      newClosedAt = newClosedAt ?? new Date();
    } else if (targetStage.type === 'LOST') {
      newStatus = CardStatus.LOST;
      newClosedAt = newClosedAt ?? new Date();
    } else {
      newStatus = CardStatus.OPEN;
      newClosedAt = null;
    }

    await this.prisma.$transaction(async (tx) => {
      if (sameStage) {
        // Reorder within the same column.
        if (fromIndex === dto.toIndex) return;
        if (fromIndex < dto.toIndex) {
          await tx.card.updateMany({
            where: {
              pipelineId: card.pipelineId,
              stageId: fromStageId,
              order: { gt: fromIndex, lte: dto.toIndex },
            },
            data: { order: { decrement: 1 } },
          });
        } else {
          await tx.card.updateMany({
            where: {
              pipelineId: card.pipelineId,
              stageId: fromStageId,
              order: { gte: dto.toIndex, lt: fromIndex },
            },
            data: { order: { increment: 1 } },
          });
        }
      } else {
        // Close the gap in source stage.
        await tx.card.updateMany({
          where: {
            pipelineId: card.pipelineId,
            stageId: fromStageId,
            order: { gt: fromIndex },
          },
          data: { order: { decrement: 1 } },
        });
        // Open a slot in target stage.
        await tx.card.updateMany({
          where: {
            pipelineId: card.pipelineId,
            stageId: dto.toStageId,
            order: { gte: dto.toIndex },
          },
          data: { order: { increment: 1 } },
        });
      }

      await tx.card.update({
        where: { id: cardId },
        data: {
          stageId: dto.toStageId,
          order: dto.toIndex,
          status: newStatus,
          closedAt: newClosedAt,
        },
      });
    });

    this.realtime.emitToOrg(organizationId, 'card:moved', {
      cardId,
      pipelineId: card.pipelineId,
      fromStageId,
      toStageId: dto.toStageId,
      toIndex: dto.toIndex,
      status: newStatus,
    });

    // Hook de cadência: card entrou numa nova etapa → dispara a cadência com
    // gatilho STAGE_ENTER/BOTH cuja etapa casa (no-op se não houver). Só quando
    // o card está vinculado a uma conversa. Fire-and-forget.
    if (!sameStage && card.conversationId) {
      this.cadenceRunner
        .maybeStartForStage(
          card.conversationId,
          cardId,
          dto.toStageId,
          organizationId,
        )
        .catch((err) =>
          this.logger.warn(
            `cadence_maybeStartForStage_failed card=${cardId}: ${(err as Error).message}`,
          ),
        );
    }

    return this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /**
   * Lista todos os cards (pipelines) em que uma conversa está. Usado pela
   * UI da inbox pra mostrar/editar/remover a conversa de pipelines direto
   * do header da conversa (sem precisar abrir o kanban).
   */
  async listCardsByConversation(
    conversationId: string,
    organizationId: string,
  ) {
    return this.prisma.card.findMany({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            color: true,
            icon: true,
            archived: true,
          },
        },
        stage: {
          select: { id: true, name: true, color: true, type: true, order: true },
        },
      },
    });
  }

  // ─── helpers ───────────────────────────────────

  private async assertPipeline(id: string, organizationId: string) {
    const p = await this.prisma.pipeline.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pipeline not found');
    if (p.organizationId !== organizationId) throw new ForbiddenException();
    return p;
  }
}
