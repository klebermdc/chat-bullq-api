import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { AudioSourceService } from './audio-source.service';
import { resolveAssignmentScope } from '../conversations/conversation-scope';
import { ProviderKeyResolverService } from '../../ai-provider-keys/provider-key-resolver.service';
import axios from 'axios';

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
  provider: 'groq-whisper' | 'openai-whisper';
  transcribedAt: string;
}

/**
 * Transcribes audio messages using Groq Whisper (OpenAI-compatible endpoint).
 *
 * Much cheaper than OpenAI (~$0.04/hour with whisper-large-v3-turbo) and far
 * faster. We cache the result in `message.metadata.transcription` so each audio
 * is transcribed at most once. Triggered on-demand from the UI (user clicks
 * "Transcrever") rather than automatically, to keep costs predictable on busy
 * channels.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  private static readonly MAX_BYTES = 25 * 1024 * 1024; // 25MB Groq cap

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audioSource: AudioSourceService,
    private readonly providerKeys: ProviderKeyResolverService,
  ) {}

  async transcribe(
    messageId: string,
    organizationId: string,
    opts: {
      force?: boolean;
      access?: import('../../iam/channel-access/channel-access.service').ChannelAccess;
      currentUserId?: string;
      role?: OrgRole;
    } = {},
  ): Promise<TranscriptionResult> {
    const access = opts.access ?? 'ALL';
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { channel: true } } },
    });
    if (!message) throw new BadRequestException('Message not found');
    if (message.conversation.organizationId !== organizationId) {
      throw new BadRequestException('Message does not belong to organization');
    }
    if (access !== 'ALL' && !access.has(message.conversation.channelId)) {
      throw new BadRequestException('Message does not belong to organization');
    }
    if (
      opts.currentUserId &&
      resolveAssignmentScope(opts.role, opts.currentUserId) &&
      message.conversation.assignedToId !== opts.currentUserId
    ) {
      throw new ForbiddenException();
    }
    if (message.type !== 'AUDIO') {
      throw new BadRequestException('Message is not an audio');
    }

    const metadata = (message.metadata ?? {}) as Record<string, any>;
    if (!opts.force && metadata.transcription?.text) {
      return metadata.transcription as TranscriptionResult;
    }

    const audio = await this.audioSource.resolveBytes(message);
    this.logger.log(
      `Transcribing message ${messageId} (${audio.buffer.byteLength} bytes, ${audio.mimeType})`,
    );
    const result = await this.transcribeBuffer(
      organizationId,
      audio.buffer,
      audio.mimeType,
      audio.filename,
    );

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        metadata: {
          ...metadata,
          transcription: { ...result },
        } as any,
      },
    });

    return result;
  }

  /**
   * Transcreve um buffer de áudio arbitrário (não precisa ser uma Message).
   * Reusado pela transcrição de voice notes E pelo resumo de ligações (Sonax),
   * que baixa a gravação e passa os bytes direto. Resolve a chave TRANSCRIPTION
   * da org (Groq/OpenAI Whisper), faz a chamada e devolve o texto — sem persistir.
   */
  async transcribeBuffer(
    organizationId: string,
    buffer: ArrayBuffer | Buffer | Uint8Array,
    mimeType?: string,
    filename?: string,
  ): Promise<TranscriptionResult> {
    const resolved = await this.providerKeys.resolve(organizationId, 'TRANSCRIPTION');
    if (!resolved) {
      throw new BadRequestException(
        'Nenhuma chave de transcrição configurada (cadastre em Configurações > Provedores IA)',
      );
    }
    const apiKey = resolved.apiKey;
    const isGroq = resolved.provider === 'GROQ';
    const apiUrl = isGroq
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const model = resolved.model ?? (isGroq ? 'whisper-large-v3-turbo' : 'whisper-1');

    const byteLength =
      buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
    if (byteLength > TranscriptionService.MAX_BYTES) {
      throw new BadRequestException(
        `Audio too large (${Math.round(byteLength / 1024 / 1024)}MB > 25MB)`,
      );
    }

    const formData = new FormData();
    const blob = new Blob([buffer as BlobPart], {
      type: mimeType || 'audio/mpeg',
    });
    formData.append('file', blob, filename || 'audio.mp3');
    formData.append('model', model);
    formData.append('response_format', 'verbose_json');
    // Portuguese by default — pinning the language cuts latency and errors.
    formData.append('language', 'pt');
    formData.append(
      'prompt',
      'Conversa em português do Brasil entre cliente e atendente.',
    );

    let response;
    try {
      response = await axios.post(apiUrl, formData, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 120_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } catch (err: any) {
      const detail =
        err?.response?.data?.error?.message || err.message || 'unknown';
      this.logger.error(`Groq Whisper request failed: ${detail}`);
      throw new BadRequestException(`Transcrição falhou: ${detail}`);
    }

    const data = response.data;
    return {
      text: String(data?.text || '').trim(),
      language: data?.language,
      durationMs: data?.duration ? Math.round(Number(data.duration) * 1000) : undefined,
      provider: isGroq ? 'groq-whisper' : 'openai-whisper',
      transcribedAt: new Date().toISOString(),
    };
  }
}
