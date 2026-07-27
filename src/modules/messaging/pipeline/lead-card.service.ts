import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

/** Trecho do nome do funil que recebe o lead novo (case-insensitive). */
const DEFAULT_PIPELINE_MATCH = 'vendas';

/**
 * Trecho do nome da etapa de entrada — o lead ainda está com a Aline, ou seja,
 * ANTES de "Distribuir". Sobrescrevível por env se a etapa for renomeada.
 */
const DEFAULT_STAGE_MATCH = 'lead';

/**
 * Card na porta de entrada: toda conversa do cliente vira card no funil de
 * vendas já na primeira etapa ("Lead"), enquanto a Aline ainda está triando.
 * Antes disso o card só nascia no handoff (`transferToHuman` →
 * `enterLeadStage('distribu')`), então o lead ficava invisível no Kanban
 * durante toda a triagem do SDR.
 *
 * Prisma-direto de propósito: o `PipelinesService` arrasta o `CadenceRunner`
 * junto (pipelines → cadences → messaging → pipelines), e este serviço vive
 * DENTRO do messaging. Mesmo truque do `lead-stage.util.ts` do ai-agents.
 *
 * Regra de ouro: **só cria, nunca move**. Se a conversa já tem card em
 * qualquer funil, é no-op — um lead em "Proposta enviada" que manda mensagem
 * nova não pode voltar pra "Lead".
 */
@Injectable()
export class LeadCardService {
  private readonly logger = new Logger(LeadCardService.name);
  private readonly pipelineMatch: string;
  private readonly stageMatch: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {
    this.pipelineMatch = (
      process.env.LEAD_ENTRY_PIPELINE_NAME || DEFAULT_PIPELINE_MATCH
    ).toLowerCase();
    this.stageMatch = (
      process.env.LEAD_ENTRY_STAGE_NAME || DEFAULT_STAGE_MATCH
    ).toLowerCase();
  }

  /**
   * Garante que a conversa tenha card na etapa de entrada do funil de vendas.
   *
   * Best-effort: qualquer falha vira warn e devolve `null` — o pipeline de
   * inbound NUNCA pode cair porque o Kanban não colaborou.
   *
   * @returns o id do card criado, ou `null` (já tinha card / sem funil / erro).
   */
  async ensureLeadCard(params: {
    organizationId: string;
    conversationId: string;
    contactId?: string | null;
  }): Promise<string | null> {
    try {
      return await this.createIfMissing(params);
    } catch (err) {
      this.logger.warn(
        `lead-card falhou (não crítico) conv=${params.conversationId}: ${
          (err as Error)?.message
        }`,
      );
      return null;
    }
  }

  private async createIfMissing(params: {
    organizationId: string;
    conversationId: string;
    contactId?: string | null;
  }): Promise<string | null> {
    const { organizationId, conversationId, contactId } = params;

    // Já está no funil (qualquer etapa, qualquer pipeline) → não mexe.
    const existing = await this.prisma.card.findFirst({
      where: { organizationId, conversationId },
      select: { id: true },
    });
    if (existing) return null;

    const pipeline = await this.prisma.pipeline.findFirst({
      where: {
        organizationId,
        archived: false,
        name: { contains: this.pipelineMatch, mode: 'insensitive' },
      },
      select: {
        id: true,
        stages: { orderBy: { order: 'asc' }, select: { id: true, name: true } },
      },
    });
    if (!pipeline) {
      this.logger.debug(
        `lead-card: nenhum funil "${this.pipelineMatch}" na org ${organizationId} — card não criado`,
      );
      return null;
    }

    // Etapa por nome; se o nome mudou, cai na primeira etapa do funil — que é
    // exatamente onde o lead novo deve entrar de qualquer jeito.
    const stage =
      pipeline.stages.find((s) =>
        (s.name ?? '').toLowerCase().includes(this.stageMatch),
      ) ?? pipeline.stages[0];
    if (!stage) {
      this.logger.debug(
        `lead-card: funil sem etapas (org ${organizationId}) — card não criado`,
      );
      return null;
    }

    const contact = contactId
      ? await this.prisma.contact.findUnique({
          where: { id: contactId },
          select: { name: true, phone: true },
        })
      : null;

    const maxOrder = await this.prisma.card.aggregate({
      where: { stageId: stage.id },
      _max: { order: true },
    });

    const card = await this.prisma.card.create({
      data: {
        organizationId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: contact?.name || contact?.phone || 'Lead novo',
        conversationId,
        contactId: contactId ?? null,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    this.realtime.emitToOrg(organizationId, 'card:created', { card });
    this.logger.log(
      `lead-card: card ${card.id} criado na etapa "${stage.name}" (conv=${conversationId})`,
    );
    return card.id;
  }
}
