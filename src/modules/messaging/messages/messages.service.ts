import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MessageDirection,
  MessageContentType,
  MessageStatus,
  OrgRole,
} from '@prisma/client';
import { MessagesRepository } from './messages.repository';
import { SendMessageDto } from './dto/send-message.dto';
import { assertStickerAllowed } from './sticker-guard';
import { isSingleEmoji } from './reaction.util';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  ChannelAccess,
  ChannelAccessService,
} from '../../iam/channel-access/channel-access.service';
import { WatchdogService } from '../../routing/watchdog/watchdog.service';
import { SegmentReadService } from '../../segments/segment-read.service';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';
import { resolveAssignmentScope } from '../conversations/conversation-scope';
import { ConversationAccessService } from '../conversations/conversation-access.service';
import { shouldAutoAssignOnReply } from './auto-assign.util';
import { buildSnippet, messageText } from './message-search';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly repository: MessagesRepository,
    private readonly prisma: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly channelAccess: ChannelAccessService,
    private readonly watchdog: WatchdogService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly segmentRead: SegmentReadService,
    private readonly conversationAccess: ConversationAccessService,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  async send(
    dto: SendMessageDto,
    senderId: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
    /**
     * `automated`: mensagem automática de sistema (ex.: aviso de
     * fora-de-horário) enviada em nome de um atendente, mas NÃO é uma
     * resposta humana — não deve tirar a conversa de "Esperando", cancelar
     * o watchdog de "ninguém respondeu", marcar como lida em nome do
     * atendente offline nem reatribuir dono. Só persiste o OUTBOUND e
     * dispara pro canal. Comportamento independente de `system` — mudar
     * quem marca `automated` muda comportamento de produto, não é sobre
     * autorização.
     *
     * `system`: chamada interna de sistema — pula a checagem de atribuição
     * (`assertConversationAccess`). NUNCA use a partir de um handler HTTP:
     * é só para chamadores server-to-server (cadência, agendamento,
     * disponibilidade, saudação, propostas) que já validaram acesso por
     * outro caminho ou não têm um usuário autenticado real por trás.
     */
    opts?: { automated?: boolean; system?: boolean },
  ) {
    const automated = opts?.automated === true;
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
      include: {
        channel: true,
        contact: { include: { channels: true } },
      },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    // Mesma classe de bug do write-path de conversations: sem isso, um AGENT
    // conseguia mandar mensagem (e auto-atribuir a conversa pra si) numa
    // conversa de colega que a leitura já negava.
    //
    // Fail-CLOSED: a barreira roda sempre, A MENOS que o chamador se marque
    // explicitamente `system: true`. Isto é o oposto do que existia antes
    // (só rodava quando `role` vinha preenchida) — aquilo era fail-open:
    // qualquer handler HTTP futuro que esquecesse de passar `role` perdia a
    // checagem silenciosamente no endpoint mais perigoso do app (entrega
    // mensagem de verdade pro cliente no WhatsApp). Sem `role` e sem
    // `system`, `resolveAssignmentScope(undefined, senderId)` escopa ao
    // próprio remetente — o padrão seguro.
    //
    // Chamadores de sistema (cadência, dispatch de agendamento, aviso de
    // fora-de-horário, saudação de atendente, propostas) já resolveram
    // acesso por outro caminho (ou não têm usuário autenticado real por
    // trás) e se marcam `{ system: true }` para pular a barreira — ver
    // tabela de call sites no PR.
    if (opts?.system !== true) {
      await this.conversationAccess.assertConversationAccess(
        conversation.id,
        organizationId,
        role,
        senderId,
      );
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);

    const contactChannel = conversation.contact.channels.find(
      (cc) => cc.channelId === conversation.channelId,
    );
    if (!contactChannel) {
      throw new NotFoundException('Contact channel not found');
    }

    // Figurinha: `content.mediaUrl` é string livre e seria repassada ao
    // provedor sem checagem alguma. Valida ANTES de persistir a Message, senão
    // sobra uma linha OUTBOUND fantasma de um envio que nunca foi autorizado.
    if (dto.type === 'STICKER') {
      await assertStickerAllowed(this.prisma, organizationId, dto.content);
    }

    // Resolve replyTo: dois caminhos possíveis dependendo de onde a chamada
    // veio. UI manda `replyToMessageId` (id interno) e a gente busca o
    // externalId + preview no banco. Server-to-server pode mandar `replyTo`
    // pronto. Garantimos que adapter/UI tenham os campos que precisam
    // (externalMessageId pra adapter, preview/senderName pra Instagram
    // fallback, e ambos pra metadata da nossa message renderizar quote).
    let replyTo:
      | {
          externalMessageId: string;
          previewText?: string;
          senderName?: string;
          /** Internal id, not sent to provider — só pra metadata. */
          messageId?: string;
        }
      | undefined;
    if (dto.replyToMessageId) {
      const original = await this.prisma.message.findFirst({
        where: { id: dto.replyToMessageId, conversationId: conversation.id },
        select: {
          id: true,
          externalId: true,
          content: true,
          type: true,
          senderName: true,
          direction: true,
          sender: { select: { name: true } },
        },
      });
      if (!original) {
        throw new NotFoundException('Reply target message not found');
      }
      if (!original.externalId) {
        // Sem externalId não dá pra mandar reply nativo (provider não
        // conhece nossa msg interna). Joga erro claro em vez de mandar
        // mensagem sem reply silenciosamente.
        throw new ForbiddenException(
          'Mensagem citada ainda não foi sincronizada com o provider — tente novamente em alguns segundos.',
        );
      }
      const c = (original.content ?? {}) as Record<string, any>;
      const previewText: string | undefined =
        (typeof c.text === 'string' && c.text) ||
        (typeof c.caption === 'string' && c.caption) ||
        `[${original.type.toLowerCase()}]`;
      replyTo = {
        externalMessageId: original.externalId,
        previewText,
        senderName:
          original.direction === 'INBOUND'
            ? (original.senderName ?? conversation.contact.name ?? undefined)
            : (original.sender?.name ?? original.senderName ?? undefined),
        messageId: original.id,
      };
    } else if (dto.replyTo?.externalMessageId) {
      replyTo = { externalMessageId: dto.replyTo.externalMessageId };
    }

    const message = await this.repository.create({
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: dto.type as MessageContentType,
      content: dto.content,
      status: MessageStatus.QUEUED,
      senderId,
      // metadata.replyTo é consumido pela UI pra renderizar a quote box
      // em cima da bolha — sem isso o quote só apareceria no app do
      // cliente (WhatsApp/IG), nunca no nosso inbox.
      metadata: replyTo
        ? {
            replyTo: {
              messageId: replyTo.messageId,
              externalMessageId: replyTo.externalMessageId,
              previewText: replyTo.previewText,
              senderName: replyTo.senderName,
            },
          }
        : undefined,
    });

    // Auto-pause the AI on this conversation when a human replies. Behavior
    // is org-configurable (aiAutoDisableOnHuman, default true). The human
    // is now driving — don't let the agent compete with them mid-thread.
    //
    // Skip auto-pause if the conversation already has an explicit force-off,
    // OR if a human explicitly forced AI ON for this conversation (aiEnabled=true).
    // Force-on means "I want the AI here even if I send messages" — usually a
    // human + AI cooperating in COPILOT-style mode.
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiAutoDisableOnHuman: true },
    });
    const shouldDisableAi =
      conversation.aiEnabled !== false &&
      conversation.aiEnabled !== true &&
      (org?.aiAutoDisableOnHuman ?? true);

    // Auto-assign: whoever replies owns the conversation. If the current
    // assignee is someone else (or null), flip to the sender. Same-sender
    // replies are a no-op. Yes, this can "steal" from a teammate — but the
    // alternative (a conversation stuck on an inactive assignee while
    // someone else is actively replying) is worse for accountability.
    //
    // EXCEÇÃO (ver shouldAutoAssignOnReply): ADM/Owner NÃO rouba conversa que
    // já tem dono — quando um gestor entra só pra intervir/responder, o cliente
    // permanece com o agente de direito. Para transferir de propósito existe o
    // endpoint dedicado de transferência.
    const shouldAutoAssign =
      !automated &&
      shouldAutoAssignOnReply({
        currentAssigneeId: conversation.assignedToId,
        senderId,
        role,
      });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastOutboundAt: new Date(),
        // Efeitos de "humano respondeu" — pulados para mensagens automáticas
        // (o cliente continua esperando um atendente de verdade).
        ...(automated
          ? {}
          : {
              // Humano respondeu → sai de "Esperando" pra "Caixa de entrada".
              // Este é o caminho EXCLUSIVO do atendente (senderId é um user);
              // bot/IA persistem via prisma.message.create e nunca passam por
              // aqui, então o flag permanece true quando só o bot respondeu.
              awaitingHumanReply: false,
              inactivityBand: null,
              reengageDismissedAt: null,
              ...(shouldAutoAssign ? { assignedToId: senderId } : {}),
              ...(shouldDisableAi
                ? {
                    aiEnabled: false,
                    aiDisabledBy: senderId,
                    aiDisabledAt: new Date(),
                    activeAgentId: null,
                  }
                : {}),
            }),
      },
    });

    if (!automated) {
      // Humano respondeu — cancela qualquer timer de watchdog pendente e
      // zera o contador de tentativas. Se a IA estava paralisada e quem
      // resolveu foi a pessoa, conversa não deve aparecer como "presa".
      this.watchdog.cancelCheck(conversation.id).catch(() => undefined);

      // Replying = reading. The sender obviously saw the inbound stream
      // before typing — bump their lastReadAt so the unread badge resets
      // even if they never clicked the conversation first.
      await this.prisma.conversationRead.upsert({
        where: {
          userId_conversationId: {
            userId: senderId,
            conversationId: conversation.id,
          },
        },
        create: {
          userId: senderId,
          conversationId: conversation.id,
          lastReadMessageId: message.id,
          lastReadAt: new Date(),
        },
        update: {
          lastReadMessageId: message.id,
          lastReadAt: new Date(),
        },
      });
      this.realtimeGateway.emitToUser(senderId, 'conversation:read', {
        conversationId: conversation.id,
        userId: senderId,
        lastReadAt: new Date(),
      });
    }

    if (shouldAutoAssign) {
      this.realtimeGateway.emitToConversation(
        conversation.id,
        'conversation:assigned',
        {
          conversationId: conversation.id,
          assigneeId: senderId,
          reason: 'auto-assign-on-reply',
        },
      );
      this.realtimeGateway.emitToChannel(
        conversation.channelId,
        'conversation:assigned',
        {
          conversationId: conversation.id,
          assigneeId: senderId,
          reason: 'auto-assign-on-reply',
        },
      );
    }

    if (shouldDisableAi) {
      this.realtimeGateway.emitToConversation(
        conversation.id,
        'conversation:ai-toggle',
        {
          conversationId: conversation.id,
          aiEnabled: false,
          actorId: senderId,
          reason: 'human-replied',
        },
      );
    }

    // Optimistic realtime: everyone in the channel/conversation sees the
    // outbound QUEUED row instantly, independent of the outbound worker
    // roundtrip. Channel-scoped so AGENTs without access to the channel
    // don't receive this event.
    this.realtimeGateway.emitToChannel(conversation.channelId, 'message:new', {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtimeGateway.emitToConversation(conversation.id, 'message:new', {
      message,
    });

    let outboundContent = dto.content;
    if (conversation.isGroup && dto.type === 'TEXT' && outboundContent.text) {
      const sender = await this.prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true },
      });
      if (sender?.name) {
        outboundContent = {
          ...outboundContent,
          text: `*${sender.name}*\n${outboundContent.text}`,
        };
      }
    }

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: conversation.channelId,
        contactExternalId: contactChannel.externalId,
        message: {
          type: dto.type,
          content: outboundContent,
          // Manda só o que o provider precisa: externalMessageId é
          // obrigatório (Zappfy/Cloud API), preview+sender são pro
          // fallback do Instagram. messageId interno fica fora do
          // payload pro adapter — só queria persistir na metadata.
          replyTo: replyTo
            ? {
                externalMessageId: replyTo.externalMessageId,
                previewText: replyTo.previewText,
                senderName: replyTo.senderName,
              }
            : undefined,
        },
      },
      {
        // 6 tentativas com backoff FIXO de 6s: acima do limite dos gateways
        // "account protection" (1 msg/5s), então cada retry cai fora da janela
        // e a mensagem acaba entregue em vez de virar FAILED no 429.
        attempts: 6,
        backoff: { type: 'fixed', delay: 6_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return message;
  }

  /**
   * Reage a uma mensagem com um emoji.
   *
   * DE PROPÓSITO não passa pelo `send()`. Aquele método aplica o pacote de
   * efeitos de "um humano respondeu": reatribui a conversa a quem enviou,
   * desliga a IA, tira de "Esperando", zera a faixa de inatividade, cancela o
   * watchdog e marca como lida. Nada disso pode acontecer porque alguém clicou
   * num polegar — reagir no card de um colega roubaria a conversa dele e
   * desligaria a Aline no meio do atendimento.
   *
   * Também não usa o flag `automated`: aquilo significa "mensagem de sistema",
   * e reação é ação humana deliberada. Marcá-la como automática seria mentir
   * para quem ler depois.
   */
  async react(
    targetMessageId: string,
    emoji: string,
    senderId: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    if (!isSingleEmoji(emoji)) {
      throw new BadRequestException('Reação precisa ser exatamente um emoji');
    }

    const target = await this.prisma.message.findFirst({
      where: { id: targetMessageId },
      select: {
        id: true,
        externalId: true,
        conversation: {
          include: { channel: true, contact: { include: { channels: true } } },
        },
      },
    });

    const conversation = target?.conversation;
    if (!target || !conversation) {
      throw new NotFoundException('Message not found');
    }
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    await this.conversationAccess.assertConversationAccess(
      conversation.id,
      organizationId,
      role,
      senderId,
    );
    this.channelAccess.assertChannelAccess(access, conversation.channelId);

    if (!target.externalId) {
      throw new ForbiddenException(
        'Mensagem ainda não foi sincronizada com o provider — tente novamente em alguns segundos.',
      );
    }

    const contactChannel = conversation.contact.channels.find(
      (cc) => cc.channelId === conversation.channelId,
    );
    if (!contactChannel) {
      throw new NotFoundException('Contact channel not found');
    }

    // `targetMessageId` aqui é o id EXTERNO — é o campo que o mapper da Cloud
    // API lê (whatsapp-official.message-mapper.ts, case REACTION). O id interno
    // vai só na metadata, para a UI saber a qual bolha a reação pertence.
    const content = {
      reaction: { emoji, targetMessageId: target.externalId },
    };

    const message = await this.repository.create({
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageContentType.REACTION,
      content,
      status: MessageStatus.QUEUED,
      senderId,
      metadata: { reactionTo: target.id },
    });

    this.realtimeGateway.emitToConversation(conversation.id, 'message:new', {
      message,
    });

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: conversation.channelId,
        contactExternalId: contactChannel.externalId,
        message: { type: MessageContentType.REACTION, content },
      },
      {
        attempts: 6,
        backoff: { type: 'fixed', delay: 6_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return message;
  }

  /**
   * Marca uma mensagem como revogada (deletada pra todos). Tenta primeiro
   * propagar pro provider — se o canal suportar (Zappfy), o cliente final
   * vê "Esta mensagem foi apagada". Se o provider não suportar (Meta WA
   * Cloud, Instagram), continuamos marcando local pra a UI esconder, mas
   * o cliente final continua vendo a mensagem original no app dele.
   *
   * Regras:
   *  - só mensagens OUTBOUND podem ser revogadas (não dá pra apagar msg
   *    do cliente — não temos permissão na API dele)
   *  - precisa de externalId (msg ainda QUEUED sem externalId não foi
   *    enviada — basta deletar do banco em outro fluxo)
   *  - re-revoke é idempotente (retorna o mesmo estado)
   */
  async revokeForEveryone(
    messageId: string,
    organizationId: string,
    actorId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ): Promise<{
    messageId: string;
    revokedAt: Date;
    revokedBy: string;
    succeededRemote: boolean;
    remoteError: string | null;
  }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: { select: { id: true, organizationId: true, channelId: true } },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    // Mesma barreira: sem isso um AGENT revogava mensagem que outro colega
    // acabou de mandar numa conversa alheia. Único chamador é o controller
    // (ator sempre é o usuário autenticado da request) — sem chamador de
    // sistema conhecido, então escopa sempre que houver actorId.
    await this.conversationAccess.assertConversationAccess(
      message.conversation.id,
      organizationId,
      role,
      actorId,
    );
    this.channelAccess.assertChannelAccess(access, message.conversation.channelId);

    if (message.direction !== MessageDirection.OUTBOUND) {
      throw new BadRequestException(
        'Só dá pra deletar pra todos mensagens enviadas pelo time/IA. ' +
          'Mensagens do cliente não podem ser deletadas (não temos permissão no app dele).',
      );
    }

    if (message.revokedAt) {
      // Idempotente: já foi revogada antes — devolve o estado atual.
      return {
        messageId: message.id,
        revokedAt: message.revokedAt,
        revokedBy: message.revokedBy ?? actorId,
        succeededRemote: message.revokeSucceededRemote ?? false,
        remoteError: null,
      };
    }

    if (!message.externalId) {
      throw new BadRequestException(
        'Mensagem ainda não foi entregue ao provider — não tem como deletar pra todos. ' +
          'Tente de novo em alguns segundos ou apague localmente.',
      );
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: message.conversation.channelId },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const adapter = this.adapterRegistry.getOutbound(channel.type);
    let succeededRemote = false;
    let remoteError: string | null = null;

    if (typeof adapter.deleteMessage === 'function') {
      try {
        await adapter.deleteMessage(channel, message.externalId);
        succeededRemote = true;
      } catch (err: unknown) {
        remoteError = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Provider delete failed (channel=${channel.type} msg=${message.id}): ${remoteError}`,
        );
      }
    } else {
      remoteError = `Adapter ${channel.type} não implementa deleteMessage.`;
    }

    const revokedAt = new Date();
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        revokedAt,
        revokedBy: actorId,
        revokeSucceededRemote: succeededRemote,
      },
    });

    // Realtime: notifica todos os ouvintes da conversa pra re-renderizar
    // a bolha como "mensagem deletada" sem refresh.
    const payload = {
      messageId: message.id,
      conversationId: message.conversation.id,
      revokedAt: revokedAt.toISOString(),
      revokedBy: actorId,
      succeededRemote,
    };
    this.realtimeGateway.emitToConversation(
      message.conversation.id,
      'message:revoked',
      payload,
    );
    this.realtimeGateway.emitToChannel(
      message.conversation.channelId,
      'message:revoked',
      payload,
    );

    this.logger.log(
      `Message revoked: id=${message.id} channel=${channel.type} succeededRemote=${succeededRemote} actor=${actorId}`,
    );

    return {
      messageId: message.id,
      revokedAt,
      revokedBy: actorId,
      succeededRemote,
      remoteError,
    };
  }

  /**
   * Guarda de acesso e escopo de toda leitura de histórico: mesma checagem de
   * organização, canal e atribuição, e o mesmo conjunto de conversas — a
   * conversa sozinha, ou o grupo de segmento inteiro (as irmãs nos outros
   * números, deduplicadas por messageid).
   */
  private async resolveHistoryScope(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<{ conversationIds: string[]; unioned: boolean }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    this.channelAccess.assertChannelAccess(access, conversation.channelId);
    if (
      currentUserId &&
      resolveAssignmentScope(role, currentUserId) &&
      conversation.assignedToId !== currentUserId
    ) {
      throw new ForbiddenException();
    }

    const siblingIds = await this.segmentRead.groupSiblingIds(conversationId);
    return {
      conversationIds: siblingIds ?? [conversationId],
      unioned: !!siblingIds,
    };
  }

  async findByConversation(
    conversationId: string,
    organizationId: string,
    page: number,
    limit: number,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const { conversationIds, unioned } = await this.resolveHistoryScope(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );

    const skip = (page - 1) * limit;
    const { messages, total } = unioned
      ? await this.repository.findByConversationsUnioned(
          conversationIds,
          skip,
          limit,
        )
      : await this.repository.findByConversation(conversationId, skip, limit);

    return {
      messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Página anterior à âncora — o "rolar pra cima" do chat. */
  async findOlderThan(
    conversationId: string,
    organizationId: string,
    beforeMessageId: string,
    limit: number,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const { conversationIds, unioned } = await this.resolveHistoryScope(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );

    return this.repository.findOlderThan(
      conversationIds,
      unioned,
      beforeMessageId,
      limit,
    );
  }

  /** Janela em volta de uma mensagem — destino do "pular até" da busca. */
  async findWindowAround(
    conversationId: string,
    organizationId: string,
    anchorMessageId: string,
    radius: number,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const { conversationIds, unioned } = await this.resolveHistoryScope(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );

    return this.repository.findWindowAround(
      conversationIds,
      unioned,
      anchorMessageId,
      radius,
    );
  }

  /** Busca por conteúdo dentro da conversa (e das irmãs de segmento). */
  async searchInConversation(
    conversationId: string,
    organizationId: string,
    term: string,
    limit: number,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ) {
    const trimmed = (term || '').trim();
    if (!trimmed) return { messages: [] };

    const { conversationIds } = await this.resolveHistoryScope(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );

    const messages = await this.repository.searchInConversations(
      conversationIds,
      trimmed,
      limit,
    );

    return {
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        direction: m.direction,
        createdAt: m.createdAt,
        providerTimestamp: m.providerTimestamp,
        senderName: m.senderName,
        snippet: buildSnippet(messageText(m.content), trimmed),
      })),
    };
  }
}
