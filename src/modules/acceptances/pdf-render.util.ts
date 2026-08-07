import { Logger } from '@nestjs/common';
import { esmImport } from './esm-import.util';

const logger = new Logger('PdfRender');

/**
 * Teto de páginas rasterizadas. Voucher é uma ou duas páginas; sem teto, um PDF
 * de 40 páginas viraria uma requisição de visão cara e lenta com o atendente
 * esperando na tela do modal.
 */
export const MAX_RENDER_PAGES = 3;

/**
 * Escala do viewport. O pdfjs usa 72 DPI na escala 1, então 2.0 dá ~144 DPI —
 * medido em ~85 KB de PNG por página A4, o bastante para o modelo ler um
 * voucher. Dobrar a escala quadruplica os bytes sem melhorar a leitura.
 */
export const RENDER_SCALE = 2.0;

/**
 * Rasteriza as primeiras páginas de um PDF em PNG, para o caminho de visão do
 * voucher escaneado (sem camada de texto).
 *
 * NUNCA lança — mesma regra do `extractPdfText`: qualquer falha (PDF
 * corrompido, binding nativo ausente na plataforma) devolve `[]` e quem chama
 * decide. Ler o voucher é bônus; o envio ao cliente nunca depende disso.
 */
export async function renderPdfToPngs(
  buffer: Buffer,
  maxPages: number = MAX_RENDER_PAGES,
  scale: number = RENDER_SCALE,
): Promise<Buffer[]> {
  let doc: any = null;
  try {
    const pdfjs = await esmImport('pdfjs-dist/legacy/build/pdf.mjs');

    // `require` preguiçoso de propósito: o `@napi-rs/canvas` vem como
    // dependência OPCIONAL do pdfjs, e um `import` no topo do arquivo faria o
    // processo morrer na carga do módulo numa plataforma sem binding
    // pré-compilado — derrubando o boot inteiro por causa de um recurso
    // acessório. Aqui dentro do try, a ausência vira só `[]`.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createCanvas } = require('@napi-rs/canvas') as {
      createCanvas: (w: number, h: number) => any;
    };

    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Mesmos ajustes do `extractPdfText`: cala o log interno do pdfjs e
      // roda no processo do Node, sem worker de browser.
      verbosity: 0,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pages = Math.min(doc.numPages, maxPages);
    const out: Buffer[] = [];

    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = canvas.getContext('2d');

      // Fundo branco explícito: o canvas nasce TRANSPARENTE e o PDF não pinta
      // fundo. Sem isto o PNG sai com texto preto sobre alfa zero — que vira
      // preto sobre preto quando o modelo achata a transparência, e o voucher
      // volta ilegível mesmo tendo renderizado "com sucesso".
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      out.push(canvas.toBuffer('image/png'));
    }

    return out;
  } catch (err) {
    logger.warn(`falha ao rasterizar PDF: ${(err as Error)?.message ?? err}`);
    return [];
  } finally {
    // `destroy` também pode estourar num doc meio inicializado; engolir aqui
    // é seguro porque o resultado já foi decidido acima.
    try {
      await doc?.destroy();
    } catch {
      /* nada a fazer */
    }
  }
}
