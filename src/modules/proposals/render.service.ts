import { Injectable, Logger } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import {
  PROPOSAL_RENDER_DELAY_MS,
  PROPOSAL_RENDER_TIMEOUT_MS,
} from './proposals.constants';

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
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: PROPOSAL_RENDER_TIMEOUT_MS,
      });
      await page.waitForTimeout(delayMs);
      return await page.innerText('body');
    } finally {
      await browser.close();
    }
  }
}
