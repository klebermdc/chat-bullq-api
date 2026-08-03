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

  // Cobre tanto o que o MediaRecorder do navegador grava (webm/mp4) quanto o
  // que o SISTEMA OPERACIONAL rotula num arquivo anexado do dispositivo: o
  // iPhone manda `audio/x-m4a`, o Android manda `audio/3gpp`/`audio/amr`, e o
  // Windows manda `audio/x-wav`/`audio/wave`. Tudo aqui vira MP3 no ffmpeg
  // logo abaixo, então aceitar é seguro — o que sai é sempre audio/mpeg.
  private static readonly ALLOWED_AUDIO_MIME = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/ogg',
    'audio/opus',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/vnd.wave',
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/3gpp',
    'audio/amr',
    'audio/flac',
    'audio/x-flac',
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
    const key = `audio/${dateFolder}/${id}.mp3`;

    // We produce MP3 (not OGG/Opus). The provider (Uazapi) never delivered our
    // OGG/Opus voice notes to recipients ("áudio não está mais disponível") —
    // its ptt/audio path chokes on our Opus regardless of type. MP3 is
    // universally accepted and plays on every WhatsApp client. Sent as
    // `type: audio`. Browsers record WebM/MP4 via MediaRecorder; we always
    // re-encode (also fixes the missing-duration header that showed 0:00).
    const tmpBase = path.join(os.tmpdir(), `aud-${id}`);
    // A extensão do nome original manda: num arquivo anexado do dispositivo o
    // mime do SO às vezes é vago (`audio/3gpp` para um .amr), e o ffmpeg usa a
    // extensão do arquivo de entrada pra escolher o demuxer. Com `.bin` ele
    // chuta pelo conteúdo e falha em containers sem magic bytes claros.
    const srcTmp = `${tmpBase}${this.extFor(mime, file.originalname)}`;
    const mp3Tmp = `${tmpBase}.mp3`;
    await fs.promises.writeFile(srcTmp, file.buffer);
    let mp3Buffer: Buffer;
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-i', srcTmp,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '64k',
          '-ac', '1',
          '-ar', '48000',
          mp3Tmp,
        ],
        { timeout: 30_000 },
      );
      mp3Buffer = await fs.promises.readFile(mp3Tmp);
    } catch (err: any) {
      this.logger.error(`ffmpeg transcode failed: ${err.message}`);
      throw new BadRequestException('Failed to process audio');
    } finally {
      await fs.promises.unlink(srcTmp).catch(() => undefined);
      await fs.promises.unlink(mp3Tmp).catch(() => undefined);
    }

    await this.storage.put(key, mp3Buffer, 'audio/mpeg');

    const url = `${this.publicBaseUrl}/${key}`;
    this.logger.log(`Audio saved: ${key} -> ${url}`);
    return {
      url,
      mimeType: 'audio/mpeg',
      size: mp3Buffer.byteLength,
      filename: `${id}.mp3`,
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
    if (m === 'audio/mp3') return '.mp3';
    if (m === 'audio/aac') return '.aac';
    if (m === 'audio/opus') return '.opus';
    if (m === 'audio/3gpp') return '.3gp';
    if (m === 'audio/amr') return '.amr';
    if (m === 'audio/flac' || m === 'audio/x-flac') return '.flac';
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
