import { Logger } from '@nestjs/common';
import { esmImport } from './esm-import.util';

const logger = new Logger('PdfText');

/**
 * Piso de texto útil (caracteres, após colapsar espaços) para considerar que o
 * PDF tem camada de texto de verdade. Abaixo disso tratamos como ilegível
 * (escaneado) — mandar ruído pro LLM só produz invenção de volta.
 */
export const MIN_USEFUL_CHARS = 200;

/**
 * Extrai a camada de texto de um PDF. NUNCA lança: qualquer falha (arquivo
 * corrompido, PDF protegido, sem camada de texto) devolve string vazia, e quem
 * chama decide o que fazer — aqui a leitura é um bônus, não um bloqueio.
 */
export async function extractPdfText(
  buffer: Buffer,
  minUsefulChars: number = MIN_USEFUL_CHARS,
): Promise<string> {
  try {
    const pdfjs = await esmImport('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Cala o `console.log` interno do pdfjs (ex.: "Indexing all PDF
      // objects"), que sujaria o stdout a cada voucher lido com linha solta,
      // fora do nosso Logger. 0 === VerbosityLevel.ERRORS.
      verbosity: 0,
      // Sem worker: rodamos no processo do Node, não no browser.
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
          .join(' '),
      );
    }
    await doc.destroy();

    const text = pages.join('\n').replace(/[ \t]+/g, ' ').trim();
    return text.replace(/\s/g, '').length >= minUsefulChars ? text : '';
  } catch (err) {
    logger.warn(`falha ao ler PDF: ${(err as Error)?.message ?? err}`);
    return '';
  }
}
