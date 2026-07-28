import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelAdapterRegistry } from '../../channel-hub/channel-adapter.registry';
import { resolveAssignmentScope } from '../conversations/conversation-scope';
import { UploadsService } from './uploads.service';

/**
 * Resolves a playable URL for an inbound media message and RE-HOSTS it on our
 * own domain.
 *
 * WhatsApp media arrives from the provider (Uazapi/Zappfy) as an encrypted
 * `.enc` URL or a playable URL on a provider CDN (`*.uazapi.com`). Handing that
 * provider URL straight to the browser has two problems: `.enc` can't be
 * decoded, and even the playable provider domain gets blocked by client-side
 * network security filters (CUJO/ISP block lists have flagged `uazapi.com`) —
 * the image silently fails to load even though the URL is valid.
 *
 * So we download the bytes SERVER-SIDE (the API host isn't behind the client's
 * filter) and store them under our own `/api/v1/uploads/...` — the same trick
 * the audio pipeline uses. The playable URL is cached on `content.mediaUrl`, so
 * each message hits the provider at most once and no client ever loads from the
 * provider domain. Outbound media (already our upload) and anything already
 * re-hosted short-circuit untouched.
 */
@Injectable()
export class MediaResolverService {
  private readonly logger = new Logger(MediaResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly uploads: UploadsService,
  ) {}

  async resolve(
    messageId: string,
    organizationId: string,
    access: import('../../iam/channel-access/channel-access.service').ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<{ url: string; mimeType?: string }> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { channel: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.conversation.organizationId !== organizationId) {
      throw new NotFoundException('Message not found');
    }
    if (
      access !== 'ALL' &&
      !access.has(message.conversation.channelId)
    ) {
      throw new NotFoundException('Message not found');
    }
    if (
      currentUserId &&
      resolveAssignmentScope(role, currentUserId) &&
      message.conversation.assignedToId !== currentUserId
    ) {
      throw new ForbiddenException();
    }

    const content = (message.content ?? {}) as Record<string, any>;

    // Já está no nosso domínio (mídia outbound que subimos, ou uma inbound já
    // re-hospedada numa chamada anterior) → nada a fazer.
    if (
      typeof content.mediaUrl === 'string' &&
      content.mediaUrl &&
      isOwnUpload(content.mediaUrl)
    ) {
      return { url: content.mediaUrl, mimeType: content.mimeType };
    }

    const channel = message.conversation.channel;
    const adapter = this.adapterRegistry.getOutbound(channel.type);
    const mimeTypeHint =
      typeof content.mimeType === 'string' ? content.mimeType : undefined;
    const originalFilename =
      typeof content.fileName === 'string' ? content.fileName : undefined;
    const mediaId =
      typeof content.mediaId === 'string' ? content.mediaId : undefined;

    // Descobre a FONTE dos bytes no provedor: uma URL tocável (uazapi CDN, IG,
    // …), ou — quando ausente/.enc — o decrypt do provedor, ou um mediaId (WA
    // Cloud). O que NÃO dá pra fazer é baixar direto de uma `.enc`.
    let providerUrl: string | undefined;
    let mimeType = mimeTypeHint;

    if (
      typeof content.mediaUrl === 'string' &&
      content.mediaUrl &&
      !isUnplayableUrl(content.mediaUrl)
    ) {
      providerUrl = content.mediaUrl;
    } else if (!mediaId) {
      const externalId = message.externalId;
      if (!externalId) {
        throw new BadRequestException('Message has no external id to resolve');
      }
      if (!adapter.resolveInboundMediaUrl) {
        throw new BadRequestException(
          `Media resolution not implemented for ${channel.type}`,
        );
      }
      const resolved = await adapter.resolveInboundMediaUrl(channel, {
        externalMessageId: externalId,
        mediaId: undefined,
        mimeType: mimeTypeHint,
        originalFilename,
      });
      providerUrl = resolved.fileUrl;
      mimeType = mimeType || resolved.mimeType;
    }

    // Baixa server-side (fora do filtro do cliente) e re-hospeda no nosso
    // domínio. Se falhar (provedor fora, arquivo grande demais, storage), cai
    // pro fallback: devolve a URL do provedor SEM cachear, pra próxima tentativa
    // refazer a re-hospedagem.
    try {
      const buffer =
        mediaId && !providerUrl
          ? await adapter.downloadMedia(channel, mediaId)
          : await adapter.downloadMedia(channel, providerUrl!);

      const saved = await this.uploads.saveInboundMedia({
        buffer,
        mimeType: mimeType || 'application/octet-stream',
        channelId: channel.id,
        originalFilename,
      });

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          content: {
            ...content,
            mediaUrl: saved.url,
            ...(saved.mimeType && !content.mimeType
              ? { mimeType: saved.mimeType }
              : {}),
          } as any,
        },
      });

      return { url: saved.url, mimeType: saved.mimeType || mimeType };
    } catch (err: any) {
      this.logger.warn(
        `media re-host failed for msg=${messageId}: ${err?.message}; ` +
          `falling back to provider URL`,
      );
      if (providerUrl) return { url: providerUrl, mimeType };
      throw err;
    }
  }
}

/**
 * URL que já é nossa (`.../api/v1/uploads/...`), absoluta ou relativa. Nesse
 * caso não re-hospedamos — é mídia que subimos (outbound) ou já cacheada.
 */
function isOwnUpload(u: string): boolean {
  return /\/api\/v1\/uploads\//i.test(u);
}

/**
 * Uma URL `.enc` em mmg.whatsapp.net é o payload criptografado que o WhatsApp
 * entrega no webhook; não dá pra baixar/decodificar direto — precisa passar
 * pelo decrypt do provedor antes de re-hospedar.
 */
function isUnplayableUrl(u: string): boolean {
  return /\.enc(\?|$)/i.test(u) || /mmg\.whatsapp\.net/i.test(u);
}
