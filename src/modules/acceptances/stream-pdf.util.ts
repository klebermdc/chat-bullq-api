import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

import type { StorageService } from '../storage/storage.service';

/**
 * Envia o PDF do aceite pela resposta HTTP.
 *
 * Compartilhado pelas duas rotas que servem o comprovante — a do operador
 * (JWT + organização) e a do cliente (token do aceite). Quem chama já decidiu
 * que o pedido está autorizado; aqui só se resolve o transporte.
 *
 * `private, max-age=0`: o inverso do que a rota de uploads fazia. Lá o PDF
 * assinado ia com `public, immutable`, então bastava a URL vazar uma vez para
 * ficar cacheado e acessível para sempre.
 */
export async function streamStoredPdf(
  storage: StorageService,
  key: string,
  res: Response,
): Promise<void> {
  const stat = await storage.stat(key);
  if (!stat) throw new NotFoundException('PDF do aceite não encontrado.');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  // `inline` para abrir no visualizador do navegador, como era antes.
  res.setHeader('Content-Disposition', 'inline; filename="aceite.pdf"');

  const stream = await storage.getStream(key);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
