import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, ConversationStatus, MessageContentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { computeWhatsappWindow } from '../messaging/conversations/whatsapp-window.util';
import { StartConversationService } from '../messaging/conversations/start-conversation.service';
import { UploadsService } from '../messaging/messages/uploads.service';
import { ConversationResolverService } from '../messaging/pipeline/conversation-resolver.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { buildNfseTemplateContent, nfseMessageText } from './nfse-message';
import type { NfsePayload } from './nfse-payload';
import { downloadNfsePdf, NfsePdfError } from './nfse-pdf-downloader';
import { NfseDeliveryError, NfseWhatsappSender } from './nfse-whatsapp-sender.service';

export const NFSE_CHANNEL_ENV = 'NFSE_CHANNEL_ID';
/** Template (UTILITY, cabeçalho DOCUMENT) usado quando a janela de 24h está fechada. */
export const NFSE_TEMPLATE_NAME = 'nfse_guiamento';
/** Envio parado em SENDING por mais que isso (queda no meio) pode ser refeito. */
const STALE_SENDING_MS = 10 * 60 * 1000;
const SOURCE = 'nfse_hub';
/** `mode` enquanto só o texto saiu: a nova tentativa manda só o PDF. */
const TEXT_SENT = 'text_sent';
const PDF_MIME = 'application/pdf';

export type NfseResult =
  | { status: 200; body: { ok: true; duplicado: true } }
  | { status: 409; body: { ok: false; erro: string } }
  | { status: 200; body: { ok: true; messageId: string } }
  | { status: 422; body: { ok: false; erro: string } };

interface Delivery {
  mode: 'text_and_document' | 'template';
  messageId: string;
  externalId: string;
  organizationId: string;
  channelId: string;
  contactId: string;
  conversationId: string;
}

interface Target {
  channel: Channel;
  contactId: string;
  contactExternalId: string;
  conversationId: string;
  /** Conversa criada ou reaberta só para a nota: volta a ficar finalizada. */
  closeAfter: boolean;
  /** Dono antes de o resolvedor reabrir sem dono: volta com o fechamento. */
  previousAssigneeId: string | null;
}

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly uploads: UploadsService,
    private readonly contacts: StartConversationService,
    private readonly resolver: ConversationResolverService,
    private readonly sender: NfseWhatsappSender,
    private readonly realtime: RealtimeGateway,
  ) {}

  async enviar(p: NfsePayload): Promise<NfseResult> {
    const claim = await this.claim(p);
    if (claim === 'sent') {
      this.logger.log(`nfse envioId=${p.envioId} status=DUPLICATE`);
      return { status: 200, body: { ok: true, duplicado: true } };
    }
    if (claim === 'in_progress') {
      return { status: 409, body: { ok: false, erro: 'Envio com este envioId em andamento; tente de novo em instantes.' } };
    }
    let d: Delivery;
    try {
      d = await this.deliver(p, claim.textSent);
    } catch (err) {
      return this.failed(p, err);
    }
    // Já saiu no WhatsApp: falha ao gravar não pode virar erro (o Hub reenviaria).
    await this.prisma.nfseDispatch
      .update({
        where: { envioId: p.envioId },
        data: {
          status: 'SENT',
          mode: d.mode,
          messageId: d.messageId,
          externalId: d.externalId || null,
          organizationId: d.organizationId,
          channelId: d.channelId,
          contactId: d.contactId,
          conversationId: d.conversationId,
          failedReason: null,
          sentAt: new Date(),
        },
      })
      .catch((e: Error) => this.logger.error(`nfse envioId=${p.envioId} status=SENT_NOT_RECORDED: ${e.message}`));
    this.logger.log(`nfse envioId=${p.envioId} status=SENT mode=${d.mode}`);
    return { status: 200, body: { ok: true, messageId: d.externalId || d.messageId } };
  }

  private async failed(p: NfsePayload, err: unknown): Promise<NfseResult> {
    const expected = err instanceof NfseDeliveryError || err instanceof NfsePdfError;
    const reason = expected ? (err as Error).message : 'Falha inesperada ao enviar a NFS-e.';
    await this.prisma.nfseDispatch.update({
      where: { envioId: p.envioId },
      data: { status: 'FAILED', failedReason: reason },
    });
    this.logger.warn(`nfse envioId=${p.envioId} status=FAILED`);
    if (!expected) throw err;
    return { status: 422, body: { ok: false, erro: reason } };
  }

  /**
   * Reserva o envioId. 'sent' = já enviado; 'in_progress' = outra chamada
   * enviando agora. Falhou antes? Pode tentar de novo com o mesmo envioId
   * (sem repetir o texto se ele já tinha saído).
   */
  private async claim(p: NfsePayload): Promise<'sent' | 'in_progress' | { textSent: boolean }> {
    const data = { phone: p.telefone, numeroNfse: p.numeroNfse, valor: new Prisma.Decimal(p.valor) };
    try {
      await this.prisma.nfseDispatch.create({ data: { envioId: p.envioId, status: 'SENDING', ...data } });
      return { textSent: false };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    const retry = await this.prisma.nfseDispatch.updateMany({
      where: {
        envioId: p.envioId,
        OR: [
          { status: 'FAILED' },
          { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
        ],
      },
      data: { status: 'SENDING', failedReason: null, ...data },
    });
    const row = await this.prisma.nfseDispatch.findUnique({
      where: { envioId: p.envioId },
      select: { status: true, mode: true },
    });
    if (retry.count > 0) return { textSent: row?.mode === TEXT_SENT };
    return row?.status === 'SENT' ? 'sent' : 'in_progress';
  }

  private async deliver(p: NfsePayload, textSent: boolean): Promise<Delivery> {
    const channel = await this.channel();
    const pdf = await downloadNfsePdf(p.pdfUrl);
    const upload = await this.uploads.saveMedia({ buffer: pdf, mimetype: PDF_MIME, originalname: p.pdfNome });
    const target = await this.target(channel, p);
    try {
      const sent = (await this.isWindowOpen(channel, target.conversationId))
        ? await this.sendTextAndDocument(target, p, upload.url, textSent)
        : await this.sendTemplate(target, p, upload.url);
      return {
        ...sent,
        organizationId: channel.organizationId,
        channelId: channel.id,
        contactId: target.contactId,
        conversationId: target.conversationId,
      };
    } finally {
      await this.touchConversation(target);
    }
  }

  private async channel(): Promise<Channel> {
    const id = this.config.get<string>(NFSE_CHANNEL_ENV)?.trim();
    const channel = id
      ? await this.prisma.channel.findFirst({ where: { id, deletedAt: null } })
      : null;
    if (!channel) throw new NfseDeliveryError('Canal de WhatsApp da NFS-e não configurado.');
    if (!channel.isActive) throw new NfseDeliveryError('Canal de WhatsApp da OFP desconectado.');
    return channel;
  }

  private async target(channel: Channel, p: NfsePayload): Promise<Target> {
    const { contactId, externalId } = await this.contacts.resolveContact(channel.organizationId, channel.id, {
      phone: p.telefone,
      name: p.nome,
      externalId: this.contacts.toExternalId(channel.type, p.telefone),
    });
    const resolved = await this.resolver.resolve(channel.organizationId, channel.id, contactId);
    return {
      channel,
      contactId,
      contactExternalId: externalId,
      conversationId: resolved.conversationId,
      closeAfter: resolved.isNew || resolved.wasReopened,
      previousAssigneeId: resolved.previousAssigneeId ?? null,
    };
  }

  private async isWindowOpen(channel: Channel, conversationId: string): Promise<boolean> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastInboundAt: true },
    });
    return computeWhatsappWindow({
      channelType: channel.type,
      lastInboundAt: conv?.lastInboundAt ?? null,
      ctwaClidAt: null,
      now: new Date(),
    }).open;
  }

  private async sendTextAndDocument(t: Target, p: NfsePayload, pdfLink: string, textSent: boolean) {
    const metadata = { source: SOURCE, envioId: p.envioId };
    if (!textSent) {
      await this.sender.send({
        ...this.base(t),
        type: MessageContentType.TEXT,
        content: { text: nfseMessageText(p) },
        metadata,
      });
      await this.prisma.nfseDispatch.update({ where: { envioId: p.envioId }, data: { mode: TEXT_SENT } });
    }
    const doc = await this.sender.send({
      ...this.base(t),
      type: MessageContentType.DOCUMENT,
      content: { mediaUrl: pdfLink, fileName: p.pdfNome, mimeType: PDF_MIME },
      metadata,
    });
    return { mode: 'text_and_document' as const, ...doc };
  }

  private async sendTemplate(t: Target, p: NfsePayload, pdfLink: string) {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { channelId: t.channel.id, name: NFSE_TEMPLATE_NAME, status: 'APPROVED' },
      select: { name: true, language: true },
    });
    if (!template) {
      throw new NfseDeliveryError(
        `Janela de 24h do WhatsApp fechada e o template "${NFSE_TEMPLATE_NAME}" ainda não está aprovado.`,
      );
    }
    const content = buildNfseTemplateContent({
      templateName: template.name,
      language: template.language,
      pdfLink,
      ...p,
    });
    const sent = await this.sender.send({
      ...this.base(t),
      type: MessageContentType.TEMPLATE,
      content: content as Prisma.InputJsonValue,
      metadata: { source: SOURCE, envioId: p.envioId, renderedText: nfseMessageText(p) },
    });
    return { mode: 'template' as const, ...sent };
  }

  private base(t: Target) {
    return { channel: t.channel, conversationId: t.conversationId, contactExternalId: t.contactExternalId };
  }

  /** Atualiza a ordem da lista; conversa aberta só para a nota volta a finalizada. */
  private async touchConversation(t: Target): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.conversation.update({
      where: { id: t.conversationId },
      data: {
        lastMessageAt: now,
        lastOutboundAt: now,
        ...(t.closeAfter ? { status: ConversationStatus.CLOSED, closedAt: now } : {}),
        ...(t.closeAfter && t.previousAssigneeId ? { assignedToId: t.previousAssigneeId } : {}),
      },
    });
    if (t.closeAfter) {
      await this.prisma.conversationAuditLog.create({
        data: {
          conversationId: t.conversationId,
          action: 'STATUS_CHANGED',
          toValue: ConversationStatus.CLOSED,
          metadata: { trigger: SOURCE },
        },
      });
    }
    this.realtime.emitToChannel(t.channel.id, 'conversation:updated', { conversation: updated });
  }
}
