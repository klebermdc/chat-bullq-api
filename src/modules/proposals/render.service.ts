import { Injectable, Logger } from '@nestjs/common';
import { chromium, type BrowserType, type Page } from 'playwright';
import {
  PROPOSAL_RENDER_DELAY_MS,
  PROPOSAL_RENDER_TIMEOUT_MS,
} from './proposals.constants';

/** Intervalo entre as conferências do texto da página enquanto ela carrega. */
const TEXT_POLLING_MS = 500;

/**
 * Renderiza um checkout SPA (Next.js) num Chromium headless, espera o carrinho
 * montar e devolve o texto visível. O browser é lançado sob demanda e SEMPRE
 * fechado (libera RAM). `browserType` é injetável só pra teste.
 */
@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(private readonly browserType: BrowserType = chromium) {}

  async render(
    url: string,
    delayMs: number = PROPOSAL_RENDER_DELAY_MS,
  ): Promise<string> {
    return this.withPage(url, async (page) => {
      await page.waitForTimeout(delayMs);
      return page.innerText('body');
    });
  }

  /**
   * Como `render`, mas espera até o texto da página casar com `pattern` (ou
   * estoura em `timeoutMs`). Para páginas que buscam os preços depois do load
   * e nunca ficam em networkidle (ex.: o contador de preço da loja).
   */
  async renderWhenText(url: string, pattern: RegExp, timeoutMs: number): Promise<string> {
    return this.withPage(url, async (page) => {
      await page.waitForFunction(
        ({ source, flags }) => new RegExp(source, flags).test(document.body?.innerText ?? ''),
        { source: pattern.source, flags: pattern.flags },
        { timeout: timeoutMs, polling: TEXT_POLLING_MS },
      );
      return page.innerText('body');
    });
  }

  private async withPage<T>(url: string, read: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'load',
        timeout: PROPOSAL_RENDER_TIMEOUT_MS,
      });
      return await read(page);
    } finally {
      await browser.close();
    }
  }
}
