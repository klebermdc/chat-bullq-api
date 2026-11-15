import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { StorageService } from '../storage/storage.service';

/** Nome seguro para o cabeçalho: sem aspas, quebras de linha nem caminho. */
export function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]/g, '_').slice(0, 150) || 'anexo';
}

/**
 * Envia o anexo do MinIO. Sempre `attachment` + nosniff: um .html anexado
 * nunca roda no domínio da API. Pega o stream antes dos headers para que
 * falha no MinIO ainda vire resposta de erro normal.
 */
export async function streamAttachment(
  storage: StorageService,
  res: Response,
  file: { key: string; filename: string; contentType: string },
): Promise<void> {
  const stat = await storage.stat(file.key);
  if (!stat) throw new NotFoundException('Anexo não encontrado');
  const body = await storage.getStream(file.key);
  const ascii = safeFilename(file.filename);
  res.setHeader('Content-Type', file.contentType || stat.contentType);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  // Headers já foram: erro no meio só pode derrubar a conexão.
  body.on('error', (err) => res.destroy(err));
  body.pipe(res);
}
