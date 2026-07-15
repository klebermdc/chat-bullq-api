import { Injectable, Logger, Optional } from '@nestjs/common';

type FetchFn = typeof fetch;

export interface DownloadedAudio {
  buffer: ArrayBuffer;
  mimeType: string;
}

/**
 * Baixa a gravação da Sonax. A gravação é ASSÍNCRONA: fica pronta alguns minutos
 * após o desligamento. Enquanto não está pronta, a URL devolve corpo vazio/pequeno
 * ou uma página HTML. Nesses casos LANÇAMOS — o BullMQ re-tenta com backoff até a
 * gravação existir de verdade. `fetch` é injetável para teste.
 */
@Injectable()
export class RecordingDownloader {
  private readonly logger = new Logger(RecordingDownloader.name);
  private static readonly MIN_BYTES = 1024; // < 1KB = provavelmente ainda não pronta

  // @Optional(): sem o decorator, o Nest tenta resolver o tipo Function e quebra o boot.
  constructor(@Optional() private readonly fetchFn: FetchFn = fetch) {}

  async download(url: string): Promise<DownloadedAudio> {
    const res = await this.fetchFn(url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Gravação indisponível (HTTP ${res.status})`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Gravação ainda não pronta (retornou HTML)');
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < RecordingDownloader.MIN_BYTES) {
      throw new Error(
        `Gravação vazia/incompleta (${buffer.byteLength} bytes) — re-tentar`,
      );
    }
    const mimeType = contentType.split(';')[0].trim() || 'audio/mpeg';
    this.logger.log(`Gravação baixada: ${buffer.byteLength} bytes (${mimeType})`);
    return { buffer, mimeType };
  }
}
