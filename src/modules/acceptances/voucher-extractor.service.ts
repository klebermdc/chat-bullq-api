import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_SIMPLE_MODEL } from '../ai-agents/llm/llm.constants';
import { VOUCHER_EXTRACT_SYSTEM_PROMPT } from './voucher.prompts';
import { AcceptanceItem, ExtractedVoucher } from './acceptances.types';

const EMPTY: ExtractedVoucher = { items: [], orderRef: null };

/**
 * Extrator grounded (temp 0) dos itens de um voucher a partir do texto do PDF.
 * Espelha o `OrderExtractorService` da Ficha do Pedido, inclusive o parse
 * tolerante. Qualquer falha devolve vazio — a leitura é um bônus, o envio do
 * voucher não depende dela.
 */
@Injectable()
export class VoucherExtractorService {
  private readonly logger = new Logger(VoucherExtractorService.name);

  constructor(private readonly llm: LlmService) {}

  async extract(
    voucherText: string,
    organizationId: string,
  ): Promise<ExtractedVoucher> {
    if (!voucherText?.trim()) return EMPTY;

    try {
      const resp = await this.llm.complete({
        organizationId,
        modelId: SAKANA_SIMPLE_MODEL,
        temperature: 0,
        maxTokens: 1200,
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: VOUCHER_EXTRACT_SYSTEM_PROMPT, cache: true },
            ],
          },
          {
            role: 'user',
            content: `<<<VOUCHER>>>\n${voucherText}\n<<<END>>>`,
          },
        ],
      });

      return this.parse(this.textOnly(resp.message.content));
    } catch (err) {
      this.logger.warn(
        `extração de voucher falhou: ${(err as Error)?.message ?? err}`,
      );
      return EMPTY;
    }
  }

  private textOnly(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === 'string') return content;
    return content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }

  /** Tira `<think>...</think>`, pega o primeiro `{...}` balanceado, filtra lixo. */
  private parse(raw: string): ExtractedVoucher {
    try {
      const noThink = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      const start = noThink.indexOf('{');
      const end = noThink.lastIndexOf('}');
      if (start < 0 || end <= start) return EMPTY;

      const j = JSON.parse(noThink.slice(start, end + 1));

      return {
        items: this.normalizeItems(j.items),
        orderRef:
          typeof j.orderRef === 'string' && j.orderRef.trim()
            ? j.orderRef.trim()
            : null,
      };
    } catch {
      return EMPTY;
    }
  }

  private normalizeItems(raw: unknown): AcceptanceItem[] {
    if (!Array.isArray(raw)) return [];
    const out: AcceptanceItem[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const r = entry as Record<string, unknown>;
      if (typeof r.description !== 'string' || !r.description.trim()) continue;

      const item: AcceptanceItem = { description: r.description.trim() };
      if (typeof r.qty === 'number' && Number.isFinite(r.qty)) item.qty = r.qty;
      if (typeof r.date === 'string' && r.date.trim()) item.date = r.date.trim();
      if (typeof r.ref === 'string' && r.ref.trim()) item.ref = r.ref.trim();
      if (typeof r.note === 'string' && r.note.trim()) item.note = r.note.trim();
      out.push(item);
    }
    return out;
  }
}
