import type { Response } from 'express';

const MAX_FILENAME_LENGTH = 80;

/** Nome de arquivo ASCII seguro a partir do título ("Contrato de Viagem" → contrato-de-viagem.pdf). */
export function pdfFilename(title: string): string {
  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FILENAME_LENGTH);
  return `${slug || 'documento'}.pdf`;
}

/** Envia um PDF gerado na hora (não guardado), sem cache. */
export function sendPdf(res: Response, buffer: Buffer, title: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename(title)}"`);
  res.end(buffer);
}
