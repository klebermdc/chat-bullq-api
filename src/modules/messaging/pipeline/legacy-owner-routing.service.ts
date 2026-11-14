import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ConversationFsmService } from '../conversations/conversation-fsm.service';
import { parseLegacyTags } from './legacy-tags.util';

export interface LegacyRouteParams {
  organizationId: string;
  conversationId: string;
  contactId: string;
  /** Dono da conversa reaberta antes de finalizar (o resolver tira o dono). */
  previousOwnerId?: string | null;
}

export interface LegacyRouteOptions {
  /**
   * Lead do site que recebeu o template de retorno: a conversa fica com o
   * vendedor dono, mas a IA (este agente) conduz as perguntas até o handoff.
   */
  aiUntilHandoffAgentId?: string;
}

export type LegacyRouteResult =
  | { routed: true; userId: string; vendedor: string; via?: 'previous_owner' }
  | { routed: false; reason: 'no_phone' | 'not_found' }
  | { routed: false; reason: 'unmapped' | 'inactive'; vendedor: string };

interface LegacyOwnerRow {
  vendedor: string | null;
  etapa: string | null;
  tags: string | null;
  user_id: string | null;
}

interface PreviousOwnerRow {
  user_id: string;
  name: string | null;
}

/**
 * Cliente que volta a escrever vai para quem já o atendia, sem passar pela
 * triagem da Aline nem pela fila "Distribuir".
 *
 * 1. Carteira legada (tabela `contatos_legado`, exportada da Umbler): as
 *    etiquetas da planilha vão para o contato; a do vendedor vem do
 *    `fsm.assign`. O nome da planilha ("Renata", "Carol"...) vira usuário pela
 *    tabela `contatos_legado_vendedores`.
 * 2. Fora da carteira (cliente que chegou depois da Umbler, Instagram, ou
 *    vendedor da planilha que saiu): o último atendente do contato, em
 *    qualquer canal, se ainda for membro ativo da organização.
 *
 * Sem nenhum dos dois, a conversa segue o fluxo normal.
 */
@Injectable()
export class LegacyOwnerRoutingService {
  private readonly logger = new Logger(LegacyOwnerRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fsm: ConversationFsmService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async routeNewConversation(
    params: LegacyRouteParams,
    opts: LegacyRouteOptions = {},
  ): Promise<LegacyRouteResult> {
    const fromCarteira = await this.routeFromCarteira(params, opts);
    if (fromCarteira.routed) return fromCarteira;

    const previous = await this.findPreviousOwner(params);
    if (!previous) return fromCarteira;

    const vendedor = previous.name ?? previous.user_id;
    await this.assignAndSilenceAi(params.conversationId, previous.user_id, 'previous_owner', opts);
    this.logger.log(
      `retorno: conv=${params.conversationId} devolvida ao último atendente "${vendedor}" (user=${previous.user_id})`,
    );
    return { routed: true, userId: previous.user_id, vendedor, via: 'previous_owner' };
  }

  private async routeFromCarteira(
    params: LegacyRouteParams,
    opts: LegacyRouteOptions,
  ): Promise<LegacyRouteResult> {
    const { organizationId, conversationId, contactId } = params;

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { phone: true },
    });
    if (!contact?.phone) return { routed: false, reason: 'no_phone' };

    const [owner] = await this.prisma.$queryRaw<LegacyOwnerRow[]>`
      SELECT l.vendedor, l.etapa, l.tags, m.user_id
      FROM buscar_vendedor_legado(${contact.phone}) l
      LEFT JOIN contatos_legado_vendedores m ON m.vendedor = l.vendedor`;
    if (!owner?.vendedor) return { routed: false, reason: 'not_found' };

    const vendedor = owner.vendedor;
    // Vendedor sem mapeamento saiu do processo de vendas (ex.: Gabi): o
    // cliente entra "limpo", sem as etiquetas da carteira dele.
    if (!owner.user_id) {
      this.logger.warn(
        `legado: vendedor "${vendedor}" sem usuário mapeado — distribuição normal (conv=${conversationId})`,
      );
      return { routed: false, reason: 'unmapped', vendedor };
    }
    await this.applyLegacyTags(organizationId, contactId, owner.tags);

    const member = await this.prisma.userOrganization.findFirst({
      where: {
        organizationId,
        userId: owner.user_id,
        user: { isActive: true, deletedAt: null },
      },
      select: { id: true },
    });
    if (!member) {
      this.logger.log(
        `legado: vendedor "${vendedor}" inativo ou fora da org — distribuição normal (conv=${conversationId})`,
      );
      return { routed: false, reason: 'inactive', vendedor };
    }

    await this.assignAndSilenceAi(conversationId, owner.user_id, 'legacy_owner', opts);
    this.logger.log(
      `legado: conv=${conversationId} atribuída a "${vendedor}" (user=${owner.user_id})`,
    );
    return { routed: true, userId: owner.user_id, vendedor };
  }

  /**
   * Último atendente do contato, ainda ativo na organização. O dono da
   * conversa reaberta vem primeiro (o resolver já o tirou da linha); depois,
   * a conversa com dono mais recente do contato, em qualquer canal.
   */
  private async findPreviousOwner(params: LegacyRouteParams): Promise<PreviousOwnerRow | null> {
    const { organizationId, conversationId, contactId } = params;
    const hint = params.previousOwnerId ?? null;
    const rows = await this.prisma.$queryRaw<PreviousOwnerRow[]>`
      WITH candidatos AS (
        SELECT ${hint}::text AS user_id, 0 AS prioridade, now() AS quando
        WHERE ${hint}::text IS NOT NULL
        UNION ALL
        SELECT c.assigned_to_id, 1, COALESCE(c.last_message_at, c.updated_at)
        FROM conversations c
        WHERE c.organization_id = ${organizationId}
          AND c.contact_id = ${contactId}
          AND c.id <> ${conversationId}
          AND c.assigned_to_id IS NOT NULL
          AND c.deleted_at IS NULL
      )
      SELECT k.user_id, u.name
      FROM candidatos k
      JOIN users u ON u.id = k.user_id AND u.is_active AND u.deleted_at IS NULL
      JOIN user_organizations uo
        ON uo.user_id = k.user_id AND uo.organization_id = ${organizationId}
      ORDER BY k.prioridade, k.quando DESC
      LIMIT 1`;
    return rows[0] ?? null;
  }

  private async assignAndSilenceAi(
    conversationId: string,
    userId: string,
    source: 'legacy_owner' | 'previous_owner',
    opts: LegacyRouteOptions,
  ): Promise<void> {
    // Atribui antes de desligar a IA: se a atribuição perder uma corrida, a
    // conversa continua com a Aline em vez de ficar sem ninguém.
    await this.fsm.assign(conversationId, userId, undefined, source);
    // `shouldHandle` da IA ignora `assignedToId`: sem isto a Aline responderia
    // por cima do vendedor.
    // Exceção: lead do site com a Aline até o handoff — ela pergunta e
    // depois entrega a este mesmo vendedor (TransferToHumanTool).
    const aiAgentId = opts.aiUntilHandoffAgentId;
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: aiAgentId
        ? { aiEnabled: true, activeAgentId: aiAgentId, aiUntilHandoff: true }
        : { aiEnabled: false, activeAgentId: null },
    });
    this.realtime.emitToChannel(updated.channelId, 'conversation:updated', {
      conversation: updated,
    });
    this.realtime.emitToConversation(conversationId, 'conversation:updated', {
      conversation: updated,
    });
  }

  /**
   * Etiquetas são enfeite: falha aqui só loga, nunca impede a atribuição.
   * Reaproveita a etiqueta da org com o mesmo nome ignorando maiúsculas
   * ("GUIA" cai na "Guia" já existente) antes de criar uma nova.
   */
  private async applyLegacyTags(
    organizationId: string,
    contactId: string,
    rawTags: string | null,
  ): Promise<void> {
    for (const name of parseLegacyTags(rawTags)) {
      try {
        const tag =
          (await this.prisma.tag.findFirst({
            where: { organizationId, name: { equals: name, mode: 'insensitive' } },
            select: { id: true },
          })) ??
          (await this.prisma.tag.upsert({
            where: { organizationId_name: { organizationId, name } },
            create: { organizationId, name },
            update: {},
            select: { id: true },
          }));
        await this.prisma.contactTag.upsert({
          where: { contactId_tagId: { contactId, tagId: tag.id } },
          create: { contactId, tagId: tag.id },
          update: {},
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`legado: etiqueta "${name}" falhou (contato=${contactId}): ${message}`);
      }
    }
  }
}
