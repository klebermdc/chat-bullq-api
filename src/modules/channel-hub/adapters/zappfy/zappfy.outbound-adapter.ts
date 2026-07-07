import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, Channel } from '@prisma/client';
import { OutboundChannelPort } from '../../ports/outbound-channel.port';
import {
  NormalizedOutboundMessage,
  SendResult,
  RateLimitConfig,
  MessageContentType,
} from '../../ports/types';
import { StorageService } from '../../../storage/storage.service';
import { ZappfyMessageMapper } from './zappfy.message-mapper';
import { ZappfyHttpClient } from './zappfy.http-client';

@Injectable()
export class ZappfyOutboundAdapter implements OutboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_ZAPPFY;
  private readonly logger = new Logger(ZappfyOutboundAdapter.name);

  // Voice notes we inline as base64 must fit comfortably in the /send/media
  // POST body. Voice notes are small (seconds); above this we keep the URL.
  private static readonly MAX_INLINE_BYTES = 8 * 1024 * 1024;

  constructor(
    private readonly mapper: ZappfyMessageMapper,
    private readonly httpClient: ZappfyHttpClient,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const { endpoint, payload } = this.mapper.denormalize(
      message,
      contactExternalId,
    );

    // For voice notes, hand Zappfy the bytes inline (base64) instead of a URL.
    // Zappfy fetches URLs server-side, so a URL send breaks whenever our api is
    // momentarily unreachable (deploy/restart) at fetch time → WhatsApp stores a
    // dead media ref → "áudio não está mais disponível". Inlining removes that
    // dependency. If the provider rejects base64, we fall back to the URL send.
    const originalFile =
      typeof payload.file === 'string' ? payload.file : undefined;
    let inlinedFromUrl: string | undefined;
    if (
      message.type === MessageContentType.AUDIO &&
      payload.type === 'ptt' &&
      originalFile
    ) {
      const dataUri = await this.tryInlineAudio(originalFile);
      if (dataUri) {
        payload.file = dataUri;
        inlinedFromUrl = originalFile;
      }
    }

    let response: any;
    try {
      response = await this.httpClient.sendRequest(channel, endpoint, payload);
    } catch (err: any) {
      // Graceful degradation: if the inline base64 send failed, retry once with
      // the plain URL (the previous behaviour). Non-inline sends just rethrow.
      if (inlinedFromUrl) {
        this.logger.warn(
          `Inline audio send failed (${err?.response?.status || err?.message}); retrying with URL`,
        );
        payload.file = inlinedFromUrl;
        response = await this.httpClient.sendRequest(channel, endpoint, payload);
      } else {
        throw err;
      }
    }

    return {
      // Prefer `messageid` — the send response returns `id` as `<owner>:<msgid>`
      // but webhook echoes only carry the bare `<msgid>` in `messageid`. Using
      // the same shape on both sides keeps the unique (conversationId,externalId)
      // matching so the echo merges into our placeholder instead of duplicating.
      externalId:
        response?.messageid ||
        response?.key?.id ||
        response?.id ||
        '',
      providerResponse: response,
    };
  }

  /**
   * If `fileUrl` is one of our own public upload URLs, read the object from
   * storage and return it as a `data:audio/ogg;base64,...` URI. Returns null
   * (→ caller keeps the URL) for external URLs, oversized files, or any error.
   */
  private async tryInlineAudio(fileUrl: string): Promise<string | null> {
    const key = this.keyFromPublicUrl(fileUrl);
    if (!key) return null;
    try {
      const buf = await this.storage.getBuffer(key);
      if (!buf.byteLength || buf.byteLength > ZappfyOutboundAdapter.MAX_INLINE_BYTES) {
        return null;
      }
      return `data:audio/ogg;base64,${buf.toString('base64')}`;
    } catch (err: any) {
      this.logger.warn(`Failed to inline audio ${key}: ${err?.message ?? err}`);
      return null;
    }
  }

  /** Extracts the storage key from our public upload URL, else null. */
  private keyFromPublicUrl(url: string): string | null {
    const marker = '/api/v1/uploads/';
    const appUrl = (this.config.get<string>('APP_URL') || '').replace(/\/$/, '');
    // Only inline files we actually host (guards against external mediaUrls).
    if (appUrl && !url.startsWith(appUrl) && /^https?:\/\//i.test(url)) {
      return null;
    }
    const i = url.indexOf(marker);
    if (i < 0) return null;
    const rest = url.slice(i + marker.length).split(/[?#]/)[0];
    try {
      return decodeURIComponent(rest) || null;
    } catch {
      return rest || null;
    }
  }

  async sendTypingIndicator(
    channel: Channel,
    contactExternalId: string,
  ): Promise<void> {
    const number = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us/g, '');
    try {
      await this.httpClient.sendRequest(channel, '/message/presence', {
        number,
        presence: 'composing',
      });
    } catch (error: any) {
      this.logger.warn(`Typing indicator failed: ${error.message}`);
    }
  }

  async getMediaUrl(channel: Channel, mediaId: string): Promise<string> {
    return mediaId;
  }

  async downloadMedia(channel: Channel, mediaId: string): Promise<Buffer> {
    return this.httpClient.getMediaBuffer(channel, mediaId);
  }

  async resolveInboundMediaUrl(
    channel: Channel,
    hint: { externalMessageId: string },
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    return this.httpClient.resolveInboundMediaUrl(channel, hint.externalMessageId);
  }

  async deleteMessage(
    channel: Channel,
    externalMessageId: string,
  ): Promise<void> {
    await this.httpClient.deleteMessage(channel, externalMessageId);
  }

  getRateLimits(): RateLimitConfig {
    return {
      maxPerSecond: 1,
      maxPerMinute: 30,
      windowMs: 60000,
    };
  }
}
