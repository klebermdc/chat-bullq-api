import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { computeWhatsappWindow } from '../conversations/whatsapp-window.util';
import {
  buildHsmTemplateContent,
  firstName,
} from '../../scheduling/hsm-template-payload';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';

export type GreetingSource =
  | 'HANDOFF_APPROVE'
  | 'TRANSFER'
  | 'MANUAL_ASSIGN'
  | 'DISTRIBUTE';

type GreetingMessage =
  | { type: 'TEXT'; content: { text: string } }
  | { type: 'TEMPLATE'; content: Record<string, any> };

interface GreetingConversation {
  id: string;
  organizationId: string;
  isGroup: boolean;
  metadata: unknown;
  channelId: string | null;
  lastInboundAt: Date | null;
  metaWindowExpiresAt: Date | null;
  channel: { type: string } | null;
  contact: { name: string | null; ctwaClidAt: Date | null } | null;
}

/** Variável do template de distribuição que recebe o nome do vendedor. */
const SELLER_VARIABLE = '2';

@Injectable()
export class AttendantGreetingService {
  private readonly logger = new Logger(AttendantGreetingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messages: MessagesService,
    private readonly settings: AttendantGreetingSettingsService,
  ) {}

  /**
   * Apresenta o atendente ao cliente quando ele assume a conversa. Com a
   * janela de 24h aberta vai a saudação em texto (se ligada nas
   * configurações); com a janela fechada vai o template de distribuição
   * marcado no canal — sem ele, nada sai (texto livre seria recusado).
   *
   * `onlyWhenWindowClosed`: o chamador só quer o template (ex.: botão
   * Distribuir, onde a saudação em texto fica para o "Iniciar atendimento").
   *
   * Best-effort: qualquer falha é logada e engolida — nunca propaga para o
   * gatilho (atribuição/transferência/distribuição).
   */
  async greet(params: {
    conversationId: string;
    attendantUserId: string;
    source: GreetingSource;
    onlyWhenWindowClosed?: boolean;
  }): Promise<void> {
    const { conversationId, attendantUserId, source } = params;
    try {
      const conversation = await this.loadConversation(conversationId);
      if (!conversation || conversation.isGroup) return;

      // Anti-duplicidade: o mesmo atendente só se apresenta UMA vez por
      // conversa. Sem isso, os gatilhos se somam no dia a dia — distribuir,
      // aprovar o handoff e logo depois clicar "Assumir" mandaria a mesma
      // apresentação (ou o mesmo template pago) várias vezes. Outro atendente
      // assumindo depois se apresenta normalmente.
      const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
      const lastGreeting = metadata.attendantGreeting as
        | { userId?: string }
        | undefined;
      if (lastGreeting?.userId === attendantUserId) {
        this.logger.log({
          msg: 'attendant_greeting_skipped_duplicate',
          conversationId,
          attendantUserId,
          source,
        });
        return;
      }

      const attendantFirstName = await this.attendantFirstName(attendantUserId);
      const message = this.isWindowClosed(conversation)
        ? await this.distributionTemplate(conversation, attendantFirstName, source)
        : params.onlyWhenWindowClosed
          ? null
          : await this.textGreeting(conversation.organizationId, attendantFirstName);
      if (!message) return;

      // Marca ANTES de enviar: o web recarrega a aba no evento da mensagem nova
      // e já precisa ver o lead na Caixa de entrada. A distribuição NÃO tira o
      // lead do Esperando: ele fica verde ("disponível para iniciar") até o
      // vendedor clicar em Iniciar atendimento (HANDOFF_APPROVE).
      const movedToInbox =
        source === 'DISTRIBUTE' ? false : await this.moveToInbox(conversationId);
      try {
        await this.messages.send(
          { conversationId, ...message },
          attendantUserId,
          conversation.organizationId,
          'ALL',
          undefined,
          // `automated`: a saudação sai em nome do vendedor, mas não é resposta
          // humana — não cumpre o SLA nem zera o awaitingHumanReply. Quem tira
          // o lead da aba Esperando é o `greetedAwaitingReply` acima.
          { system: true, automated: true },
        );
      } catch (err) {
        if (movedToInbox) await this.undoMoveToInbox(conversationId);
        throw err;
      }

      await this.markGreeted(conversationId, metadata, {
        userId: attendantUserId,
        source,
        kind: message.type,
      });

      this.logger.log({
        msg: 'attendant_greeting_sent',
        conversationId,
        attendantUserId,
        source,
        kind: message.type,
      });
    } catch (err: any) {
      this.logger.warn(
        `attendant greeting falhou (conv=${conversationId}, source=${source}): ${err?.message ?? err}`,
      );
    }
  }

  /**
   * O vendedor puxou o lead: sai da aba Esperando para a Caixa de entrada.
   * Só vale se o cliente estava esperando — o `awaitingHumanReply` fica
   * ligado (SLA, avisos e cadência seguem contando até a resposta de verdade).
   */
  /**
   * Vendedor puxou a conversa (assumir): tira o lead do Esperando para a Caixa
   * de entrada, mesmo que a saudação não tenha saído (desligada ou já feita).
   */
  async markTakenByAttendant(conversationId: string): Promise<void> {
    await this.moveToInbox(conversationId);
  }

  private async moveToInbox(conversationId: string): Promise<boolean> {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversationId, awaitingHumanReply: true },
      data: { greetedAwaitingReply: true },
    });
    return count > 0;
  }

  private async undoMoveToInbox(conversationId: string): Promise<void> {
    await this.prisma.conversation
      .updateMany({
        where: { id: conversationId, greetedAwaitingReply: true },
        data: { greetedAwaitingReply: false },
      })
      .catch((err: any) =>
        this.logger.warn(
          `saudação: falha ao devolver ao Esperando (conv=${conversationId}): ${err?.message ?? err}`,
        ),
      );
  }

  private loadConversation(id: string): Promise<GreetingConversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        isGroup: true,
        metadata: true,
        channelId: true,
        lastInboundAt: true,
        metaWindowExpiresAt: true,
        channel: { select: { type: true } },
        contact: { select: { name: true, ctwaClidAt: true } },
      },
    }) as Promise<GreetingConversation | null>;
  }

  private async attendantFirstName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return firstName(user?.name) || 'atendente';
  }

  private isWindowClosed(conversation: GreetingConversation): boolean {
    const window = computeWhatsappWindow({
      channelType: conversation.channel?.type ?? '',
      lastInboundAt: conversation.lastInboundAt ?? null,
      ctwaClidAt: conversation.contact?.ctwaClidAt ?? null,
      metaWindowExpiresAt: conversation.metaWindowExpiresAt ?? null,
      now: new Date(),
    });
    return window.applicable && !window.open;
  }

  private async textGreeting(
    organizationId: string,
    attendantFirstName: string,
  ): Promise<GreetingMessage | null> {
    const settings = await this.settings.get(organizationId);
    if (!settings.enabled) return null;
    const text = settings.template.split('{atendente}').join(attendantFirstName);
    return { type: 'TEXT', content: { text } };
  }

  /**
   * Template aprovado marcado como "distribuição" no número da conversa, com
   * {{1}} = primeiro nome do cliente e {{2}} = primeiro nome do vendedor.
   */
  private async distributionTemplate(
    conversation: GreetingConversation,
    attendantFirstName: string,
    source: GreetingSource,
  ): Promise<GreetingMessage | null> {
    const template = conversation.channelId
      ? await this.prisma.messageTemplate.findFirst({
          where: {
            channelId: conversation.channelId,
            isDistribution: true,
            status: 'APPROVED',
          },
        })
      : null;
    const content = template
      ? buildHsmTemplateContent(template, conversation.contact?.name ?? null, {
          [SELLER_VARIABLE]: attendantFirstName,
        })
      : null;
    if (!content) {
      this.logger.log({
        msg: 'attendant_greeting_skipped_window_closed',
        conversationId: conversation.id,
        reason: template ? 'template_media_header' : 'no_distribution_template',
        source,
      });
      return null;
    }
    return { type: 'TEMPLATE', content };
  }

  /** Marca quem já se apresentou, mesclado para não pisar no resto do metadata. */
  private async markGreeted(
    conversationId: string,
    metadata: Record<string, unknown>,
    greeting: { userId: string; source: GreetingSource; kind: string },
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: {
          ...metadata,
          attendantGreeting: { ...greeting, at: new Date().toISOString() },
        },
      },
    });
  }
}
