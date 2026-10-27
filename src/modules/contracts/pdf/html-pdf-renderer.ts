import { ServiceUnavailableException } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import { RenderQueueFullError, RenderQueueTimeoutError, RenderSemaphore } from './render-semaphore';

/** Primeiro filho do <head>: sem rede, sem script; só imagem `data:` e CSS inline. */
export const PDF_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SET_CONTENT_TIMEOUT_MS = 15_000;
const PDF_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_RENDERS = 2;
const MAX_QUEUE = 10;
const MAX_QUEUE_WAIT_MS = 25_000;
const TOTAL_RENDER_TIMEOUT_MS = 45_000; // inclui a espera na fila
const BUSY_MESSAGE = 'Gerador de PDF ocupado, tente de novo em instantes';

/**
 * Compartilhado pelo processo (contratos, cotações e o que vier): no máximo 2
 * Chromium gerando PDF ao mesmo tempo, fila de até 10.
 */
const renderSemaphore = new RenderSemaphore(MAX_CONCURRENT_RENDERS, { maxQueue: MAX_QUEUE, maxWaitMs: MAX_QUEUE_WAIT_MS });

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado ao ${what} (${ms} ms)`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * HTML pronto → PDF A4 num Chromium sem JavaScript e sem rede (só `data:`).
 * O HTML é responsabilidade de quem chama: escapar tudo o que vem de fora.
 */
export class HtmlPdfRenderer {
  constructor(private readonly browserType: BrowserType = chromium) {}

  /** `what` entra na mensagem de tempo esgotado ("gerar o contrato"). */
  async render(html: string, what: string): Promise<Buffer> {
    const startedAt = Date.now();
    try {
      return await renderSemaphore.run(() => {
        const remainingMs = Math.max(TOTAL_RENDER_TIMEOUT_MS - (Date.now() - startedAt), 1);
        return withTimeout(this.renderHtml(html), remainingMs, what);
      });
    } catch (err) {
      if (err instanceof RenderQueueFullError || err instanceof RenderQueueTimeoutError) {
        throw new ServiceUnavailableException(BUSY_MESSAGE);
      }
      throw err;
    }
  }

  private async renderHtml(html: string): Promise<Buffer> {
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
      await page.setContent(html, { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS });
      const pdf = await withTimeout(page.pdf({ format: 'A4', printBackground: true }), PDF_TIMEOUT_MS, 'gerar o PDF');
      return Buffer.from(pdf);
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close();
    }
  }
}
