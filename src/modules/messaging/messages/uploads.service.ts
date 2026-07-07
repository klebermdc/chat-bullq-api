import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { StorageService } from '../../storage/storage.service';

const execFileAsync = promisify(execFile);

export interface UploadResult {
  url: string;
  mimeType: string;
  size: number;
  filename: string;
}

/**
 * Stores user-uploaded media (agent recordings) and inbound media we
 * mirror (e.g., WhatsApp Cloud requires a Bearer token to download —
 * browsers can't load it directly, so we re-host it).
 *
 * Objects live in MinIO (S3-compatible, durable) under keys that match the
 * public URL contract: `${APP_URL}/api/v1/uploads/<key>` streams the object
 * back (see main.ts). Previously these were written to the container's local
 * `uploads/` dir, which was ephemeral and wiped on every redeploy.
 *
 * ffmpeg still needs real files, so transcodes run against short-lived temp
 * files in the OS temp dir; only the finished bytes are persisted to MinIO.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  // 25MB matches OpenAI Whisper's upload cap, so audios we accept are also
  // transcribable without chunking.
  static readonly MAX_AUDIO_BYTES = 25 * 1024 * 1024;

  // 64MB upper bound for any inbound media we mirror. WhatsApp Cloud caps
  // documents at 100MB but most chat content is well under this — bigger
  // files we'd want to stream rather than buffer in memory anyway.
  static readonly MAX_INBOUND_BYTES = 64 * 1024 * 1024;

  private static readonly ALLOWED_AUDIO_MIME = new Set([
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/webm;codecs=opus',
  ]);

  // 64MB: acima do cap de vídeo do WhatsApp (16MB) e de imagem (5MB) — o
  // provider rejeita o que não aceitar; aqui só barramos abusos óbvios.
  static readonly MAX_MEDIA_BYTES = 64 * 1024 * 1024;

  private static readonly ALLOWED_MEDIA_MIME = new Set([
    // image
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    // video
    'video/mp4',
    'video/quicktime',
    'video/3gpp',
    'video/webm',
    // document
    'application/pdf',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ]);

  private readonly publicBaseUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {
    const appUrl = this.config.get<string>('APP_URL') || '';
    this.publicBaseUrl = `${appUrl.replace(/\/$/, '')}/api/v1/uploads`;
  }

  /**
   * Persists an inbound media buffer (any type — image, video, audio,
   * document, sticker) under a per-channel/per-day key and returns a
   * playable public URL. Used by adapters whose providers deliver media
   * gated behind auth (WhatsApp Cloud) or via short-lived signed URLs we
   * don't want to depend on.
   *
   * `originalFilename` is preserved when the provider gives one (typical
   * for documents) — useful for the UI to render a familiar filename and
   * for the browser's "Save As" dialog to default sensibly.
   */
  async saveInboundMedia(input: {
    buffer: Buffer;
    mimeType: string;
    channelId: string;
    originalFilename?: string | null;
  }): Promise<UploadResult> {
    if (!input?.buffer?.byteLength) {
      throw new BadRequestException('Empty inbound media');
    }
    if (input.buffer.byteLength > UploadsService.MAX_INBOUND_BYTES) {
      throw new BadRequestException(
        `Inbound media too large (max ${UploadsService.MAX_INBOUND_BYTES / 1024 / 1024}MB)`,
      );
    }

    const mime = (input.mimeType || 'application/octet-stream')
      .split(';')[0]
      .trim();
    const dateFolder = new Date().toISOString().slice(0, 10);
    const safeChannel = (input.channelId || 'unknown').replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    const id = crypto.randomBytes(16).toString('hex');
    const ext = this.extFor(mime, input.originalFilename);
    const filename = `${id}${ext}`;
    const key = `inbound/${safeChannel}/${dateFolder}/${filename}`;

    await this.storage.put(key, input.buffer, mime);

    const url = `${this.publicBaseUrl}/${key}`;
    this.logger.log(`Inbound media saved: ${key} -> ${url}`);
    return {
      url,
      mimeType: mime,
      size: input.buffer.byteLength,
      filename: input.originalFilename || filename,
    };
  }

  /**
   * Upload de mídia do operador (anexo do chat): imagem, vídeo ou documento.
   * Áudio gravado no app continua indo pelo saveAudio (que transcoda pra
   * OGG/Opus voice note); aqui é o caminho do clipe de papel.
   */
  async saveMedia(file: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  }): Promise<UploadResult> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Empty upload');
    }
    if (file.buffer.byteLength > UploadsService.MAX_MEDIA_BYTES) {
      throw new BadRequestException(
        `File too large (max ${UploadsService.MAX_MEDIA_BYTES / 1024 / 1024}MB)`,
      );
    }
    const mime = (file.mimetype || 'application/octet-stream')
      .split(';')[0]
      .trim();
    if (!UploadsService.ALLOWED_MEDIA_MIME.has(mime)) {
      throw new BadRequestException(`Unsupported file type: ${mime}`);
    }

    const dateFolder = new Date().toISOString().slice(0, 10);
    const id = crypto.randomBytes(16).toString('hex');
    const ext = this.extFor(mime, file.originalname);
    const filename = `${id}${ext}`;
    const key = `media/${dateFolder}/${filename}`;

    await this.storage.put(key, file.buffer, mime);

    const url = `${this.publicBaseUrl}/${key}`;
    this.logger.log(`Media saved: ${key} -> ${url}`);
    return {
      url,
      mimeType: mime,
      size: file.buffer.byteLength,
      filename: file.originalname || filename,
    };
  }

  async saveAudio(file: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  }): Promise<UploadResult> {
    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('Empty upload');
    }
    if (file.buffer.byteLength > UploadsService.MAX_AUDIO_BYTES) {
      throw new BadRequestException(
        `Audio too large (max ${UploadsService.MAX_AUDIO_BYTES / 1024 / 1024}MB)`,
      );
    }
    // Normalise mimetype: browsers sometimes send `audio/webm;codecs=opus`.
    const mime = (file.mimetype || '').split(';')[0].trim() || 'audio/webm';
    if (
      !UploadsService.ALLOWED_AUDIO_MIME.has(file.mimetype) &&
      !UploadsService.ALLOWED_AUDIO_MIME.has(mime)
    ) {
      throw new BadRequestException(
        `Unsupported audio mime type: ${file.mimetype}`,
      );
    }

    const dateFolder = new Date().toISOString().slice(0, 10);
    const id = crypto.randomBytes(16).toString('hex');
    const key = `audio/${dateFolder}/${id}.ogg`;

    // WhatsApp voice notes require OGG/Opus. Browsers (esp. Chrome/Firefox)
    // record in WebM/Opus via MediaRecorder — the codec is compatible but the
    // container is not, so Zappfy rejects the send (HTTP 500). We also rely on
    // the re-encode to write proper duration headers (MediaRecorder streams
    // webm without duration, so the <audio> element shows 0:00).
    let oggBuffer: Buffer;
    if (mime === 'audio/ogg') {
      oggBuffer = file.buffer;
    } else {
      const tmpBase = path.join(os.tmpdir(), `aud-${id}`);
      const srcTmp = `${tmpBase}${this.extFor(mime)}`;
      const oggTmp = `${tmpBase}.ogg`;
      await fs.promises.writeFile(srcTmp, file.buffer);
      try {
        await execFileAsync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', srcTmp,
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-ac', '1',
            '-ar', '48000',
            '-application', 'voip',
            oggTmp,
          ],
          { timeout: 30_000 },
        );
        oggBuffer = await fs.promises.readFile(oggTmp);
      } catch (err: any) {
        this.logger.error(`ffmpeg transcode failed: ${err.message}`);
        throw new BadRequestException('Failed to process audio');
      } finally {
        await fs.promises.unlink(srcTmp).catch(() => undefined);
        await fs.promises.unlink(oggTmp).catch(() => undefined);
      }
    }

    await this.storage.put(key, oggBuffer, 'audio/ogg');

    const url = `${this.publicBaseUrl}/${key}`;
    this.logger.log(`Audio saved: ${key} -> ${url}`);
    return {
      url,
      mimeType: 'audio/ogg',
      size: oggBuffer.byteLength,
      filename: `${id}.ogg`,
    };
  }

  /**
   * Produces a browser-universal playback rendition (AAC in an MP4/M4A
   * container) of an audio message and caches it at `playback/{id}.m4a`.
   *
   * Why: WhatsApp voice notes — both the ones we send (transcoded to OGG/Opus)
   * and the ones customers send — are OGG/Opus, which Safari/iOS cannot decode
   * (the <audio> element loads the header but stays silent). AAC/M4A plays on
   * every browser, so the panel points its player at this instead of the OGG.
   *
   * Idempotent: returns the cached object if it already exists, so callers can
   * safely hit this on every "play" without re-encoding.
   */
  async transcodeToPlayback(
    id: string,
    src: { buffer: Buffer; mimeType?: string },
  ): Promise<UploadResult> {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const key = `playback/${safeId}.m4a`;
    const url = `${this.publicBaseUrl}/${key}`;
    const filename = `${safeId}.m4a`;

    const existing = await this.storage.stat(key);
    if (existing) {
      return { url, mimeType: 'audio/mp4', size: existing.size, filename };
    }

    if (!src?.buffer?.byteLength) {
      throw new BadRequestException('Empty audio source for playback');
    }

    const tmpBase = path.join(
      os.tmpdir(),
      `pb-${safeId}-${crypto.randomBytes(4).toString('hex')}`,
    );
    const srcTmp = `${tmpBase}.src${this.extFor(src.mimeType || 'audio/ogg')}`;
    const outTmp = `${tmpBase}.m4a`;
    await fs.promises.writeFile(srcTmp, src.buffer);
    let outBuffer: Buffer;
    try {
      // -movflags +faststart moves the moov atom to the front so <audio> can
      // begin playing before the whole file downloads.
      await execFileAsync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-i', srcTmp,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '96k',
          '-ar', '44100',
          '-movflags', '+faststart',
          outTmp,
        ],
        { timeout: 60_000 },
      );
      outBuffer = await fs.promises.readFile(outTmp);
    } catch (err: any) {
      this.logger.error(`ffmpeg playback transcode failed: ${err.message}`);
      throw new BadRequestException('Failed to process audio for playback');
    } finally {
      await fs.promises.unlink(srcTmp).catch(() => undefined);
      await fs.promises.unlink(outTmp).catch(() => undefined);
    }

    await this.storage.put(key, outBuffer, 'audio/mp4');

    this.logger.log(`Playback transcode: ${key} -> ${url}`);
    return { url, mimeType: 'audio/mp4', size: outBuffer.byteLength, filename };
  }

  private extFor(mime: string, originalFilename?: string | null): string {
    // Prefer the extension from the provider-given filename when present —
    // it survives mime-sniffing oddities (e.g., Meta sometimes returns
    // application/octet-stream for known doc types).
    if (originalFilename) {
      const ext = path.extname(originalFilename).toLowerCase();
      if (ext && /^\.[a-z0-9]{1,8}$/i.test(ext)) return ext;
    }
    const m = (mime || '').toLowerCase();
    // audio
    if (m.includes('ogg')) return '.ogg';
    if (m.includes('mpeg') && m.startsWith('audio/')) return '.mp3';
    if (m.includes('m4a') || (m.includes('mp4') && m.startsWith('audio/'))) return '.m4a';
    if (m.includes('wav')) return '.wav';
    if (m.includes('webm') && m.startsWith('audio/')) return '.webm';
    // image
    if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
    if (m === 'image/png') return '.png';
    if (m === 'image/gif') return '.gif';
    if (m === 'image/webp') return '.webp';
    if (m === 'image/heic') return '.heic';
    // video
    if (m === 'video/mp4') return '.mp4';
    if (m === 'video/quicktime') return '.mov';
    if (m === 'video/3gpp') return '.3gp';
    if (m === 'video/webm') return '.webm';
    // document
    if (m === 'application/pdf') return '.pdf';
    if (m === 'application/zip') return '.zip';
    if (m === 'application/msword') return '.doc';
    if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
    if (m === 'application/vnd.ms-excel') return '.xls';
    if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
    if (m === 'application/vnd.ms-powerpoint') return '.ppt';
    if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx';
    if (m === 'text/plain') return '.txt';
    if (m === 'text/csv') return '.csv';
    return '.bin';
  }
}
