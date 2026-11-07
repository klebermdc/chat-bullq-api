import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, ConversationStatus, Prisma } from '@prisma/client';
import { phoneVariants } from '../../common/utils/phone.util';
import { PrismaService } from '../../database/prisma.service';
import { StartConversationService } from '../messaging/conversations/start-conversation.service';
import { LeadCardService } from '../messaging/pipeline/lead-card.service';
import { LegacyOwnerRoutingService } from '../messaging/pipeline/legacy-owner-routing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { buildHsmTemplateContent } from '../scheduling/hsm-template-payload';
import { tagConversation } from './website-lead-tags';
import {
  FOLLOWUP_SOURCE,
  FollowupStatus,
  GUIAMENTO_TAG,
  HUMAN_ACTIVE_WINDOW_MS,
  RECENT_FOLLOWUP_WINDOW_MS,
  SITE_TAG,
} from './website-leads.constants';

const MAX_REASON_LENGTH = 300;

export interface FollowupOutcome {
  status: FollowupStatus | 'NOOP';
  reason?: string;
}

interface Submission {
  id: string;
  organizationId: string;
  contactId: string;
  phone: string;
  formKind: string;
  createdAt: Date;
}

/** Texto do template com os parâmetros do corpo já no lugar ({{1}} → nome). */
export function renderTemplateText(bodyText: string, content: Record<string, any>): string {
  const body = (content.components ?? []).find((c: any) => c?.type === 'body');
  const params: string[] = (body?.parameters ?? []).map((p: any) => String(p?.text ?? ''));
  let i = 0;
  return bodyText.replace(/\{\{\s*\d+\s*\}\}/g, () => params[i++] ?? '');
}

/**
 * Retorno automático ao lead do site, X minutos depois do formulário.
 *
 * Só manda o template se o cliente NÃO escreveu no canal desde o envio do
 * formulário e não há humano atendendo. Mandou → a conversa fica com a Aline
 * até o handoff (`aiUntilHandoff`), mesmo quando o telefone é da carteira de
 * um vendedor: aí ela já nasce atribuída a ele e a Aline entrega para ele.
 */
@Injectable()
export class WebsiteLeadFollowupService {
  private readonly logger = new Logger(WebsiteLeadFollowupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly startConversation: StartConversationService,
    private readonly legacyRouting: LegacyOwnerRoutingService,
    private readonly leadCard: LeadCardService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async fire(submissionId: string, now: Date = new Date()): Promise<FollowupOutcome> {
    // Trava: só um worker manda (retentativa da fila não manda 2x o pago).
    const claimed = await this.prisma.leadSubmission.updateMany({
      where: { id: submissionId, followupStatus: 'PENDING' },
      data: { followupStatus: 'SENDING' },
    });
    if (claimed.count === 0) return { status: 'NOOP' };
    const sub = await this.prisma.leadSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    try {
      return await this.run(sub, now);
    } catch (err) {
      const reason = (err as Error)?.message ?? String(err);
      this.logger.error(`retorno do lead do site falhou sub=${sub.id}: ${reason}`);
      return this.finish(sub.id, 'FAILED', reason);
    }
  }

  private async run(sub: Submission, now: Date): Promise<FollowupOutcome> {
    const config = await this.prisma.websiteLeadSettings.findUnique({
      where: { organizationId: sub.organizationId },
    });
    if (!config?.enabled || !config.channelId || !config.templateId) {
      return this.finish(sub.id, 'SKIPPED', 'disabled');
    }
    const channel = await this.prisma.channel.findFirst({
      where: {
        id: config.channelId,
        organizationId: sub.organizationId,
        deletedAt: null,
        type: ChannelType.WHATSAPP_OFFICIAL,
      },
      select: { id: true },
    });
    if (!channel) return this.finish(sub.id, 'FAILED', 'channel_missing');
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id: config.templateId, channelId: channel.id },
    });
    if (!template) return this.finish(sub.id, 'FAILED', 'template_missing');
    if (template.status !== 'APPROVED') return this.finish(sub.id, 'FAILED', 'template_not_approved');

    const contactIds = await this.relatedContactIds(sub, channel.id);
    const skip = await this.skipReason(sub, channel.id, contactIds, now);
    if (skip) return this.finish(sub.id, 'SKIPPED', skip);

    const contact = await this.prisma.contact.findUnique({
      where: { id: sub.contactId },
      select: { name: true },
    });
    const content = buildHsmTemplateContent(template, contact?.name ?? null);
    if (!content) return this.finish(sub.id, 'FAILED', 'template_media_header');
    const bodyText = String((template.components as any)?.body?.text ?? '');
    const agent = await this.channelAgent(channel.id);

    const sent = await this.startConversation.start(
      sub.organizationId,
      { channelId: channel.id, contactId: sub.contactId, template: content },
      'ALL',
      undefined,
      {
        source: FOLLOWUP_SOURCE,
        senderName: agent?.name,
        renderedText: renderTemplateText(bodyText, content),
      },
    );

    await this.handToAgent(sub, sent.conversationId, sent.contactId, agent?.id ?? null, now);
    await this.prisma.leadSubmission.update({
      where: { id: sub.id },
      data: {
        followupStatus: 'SENT',
        followupReason: null,
        followupSentAt: now,
        followupConversationId: sent.conversationId,
        followupMessageId: sent.messageId,
        followupTemplateName: template.name,
        followupCategory: template.category,
      },
    });
    this.logger.log(
      `retorno do lead do site enviado sub=${sub.id} conv=${sent.conversationId} template=${template.name}`,
    );
    return { status: 'SENT' };
  }

  /** Por que NÃO mandar, ou null. */
  private async skipReason(
    sub: Submission,
    channelId: string,
    contactIds: string[],
    now: Date,
  ): Promise<string | null> {
    const wrote = await this.prisma.message.findFirst({
      where: {
        direction: 'INBOUND',
        createdAt: { gte: sub.createdAt },
        conversation: { channelId, contactId: { in: contactIds } },
      },
      select: { id: true },
    });
    if (wrote) return 'customer_wrote';

    const human = await this.prisma.conversation.findFirst({
      where: {
        channelId,
        contactId: { in: contactIds },
        status: { not: ConversationStatus.CLOSED },
        lastHumanReplyAt: { gte: new Date(now.getTime() - HUMAN_ACTIVE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (human) return 'human_active';

    const recent = await this.prisma.leadSubmission.findFirst({
      where: {
        id: { not: sub.id },
        contactId: { in: contactIds },
        followupStatus: { in: ['SENT', 'SENDING', 'DECLINED'] },
        followupSentAt: { gte: new Date(now.getTime() - RECENT_FOLLOWUP_WINDOW_MS) },
      },
      select: { id: true },
    });
    return recent ? 'recent_followup' : null;
  }

  /**
   * Contatos que são "a mesma pessoa" no WhatsApp: o do formulário, os com o
   * mesmo telefone (com/sem 9) e o que está ligado ao canal por esse número.
   * A mensagem do cliente pode ter caído em qualquer um deles.
   */
  private async relatedContactIds(sub: Submission, channelId: string): Promise<string[]> {
    const variants = phoneVariants(sub.phone);
    const [byPhone, byChannel] = await Promise.all([
      this.prisma.contact.findMany({
        where: { organizationId: sub.organizationId, phone: { in: variants }, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.contactChannel.findMany({
        where: { channelId, externalId: { in: variants } },
        select: { contactId: true },
      }),
    ]);
    return [...new Set([sub.contactId, ...byPhone.map((c) => c.id), ...byChannel.map((c) => c.contactId)])];
  }

  private async channelAgent(channelId: string): Promise<{ id: string; name: string } | null> {
    const link = await this.prisma.aiAgentChannel.findFirst({
      where: { channelId, mode: 'AUTONOMOUS', agent: { isActive: true, deletedAt: null } },
      select: { agent: { select: { id: true, name: true } } },
    });
    return link?.agent ?? null;
  }

  /**
   * Aline responsável pela conversa até o handoff. Sem dono: tenta a carteira
   * (atribui ao vendedor, IA continua). Com dono: mantém o dono.
   */
  private async handToAgent(
    sub: Submission,
    conversationId: string,
    contactId: string,
    agentId: string | null,
    now: Date,
  ): Promise<void> {
    const conv = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { assignedToId: true, metadata: true, channelId: true },
    });

    let routedToOwner = false;
    if (agentId && !conv.assignedToId) {
      const legacy = await this.legacyRouting
        .routeNewConversation(
          { organizationId: sub.organizationId, conversationId, contactId },
          { aiUntilHandoffAgentId: agentId },
        )
        .catch((err: Error) => {
          this.logger.warn(`carteira não consultada conv=${conversationId}: ${err.message}`);
          return { routed: false as const };
        });
      routedToOwner = legacy.routed;
    }
    if (!agentId) {
      this.logger.warn(`canal sem agente de IA: conversa ${conversationId} fica na fila`);
    }

    const metadata = (conv.metadata ?? {}) as Record<string, unknown>;
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(agentId && !routedToOwner
          ? { aiEnabled: true, activeAgentId: agentId, aiUntilHandoff: true }
          : {}),
        metadata: {
          ...metadata,
          websiteLead: { submissionId: sub.id, followupSentAt: now.toISOString(), formKind: sub.formKind },
        } as Prisma.InputJsonValue,
      },
    });
    this.realtime.emitToChannel(conv.channelId, 'conversation:updated', { conversation: updated });
    this.realtime.emitToConversation(conversationId, 'conversation:updated', { conversation: updated });

    const tags = sub.formKind === 'guiamento' ? [SITE_TAG, GUIAMENTO_TAG] : [SITE_TAG];
    await tagConversation(this.prisma, sub.organizationId, conversationId, tags).catch((err: Error) =>
      this.logger.warn(`etiqueta Site falhou conv=${conversationId}: ${err.message}`),
    );
    await this.leadCard.ensureLeadCard({
      organizationId: sub.organizationId,
      conversationId,
      contactId,
    });
  }

  private async finish(id: string, status: FollowupStatus, reason: string): Promise<FollowupOutcome> {
    await this.prisma.leadSubmission.update({
      where: { id },
      data: { followupStatus: status, followupReason: reason.slice(0, MAX_REASON_LENGTH) },
    });
    this.logger.log(`retorno do lead do site sub=${id}: ${status} (${reason})`);
    return { status, reason };
  }
}
