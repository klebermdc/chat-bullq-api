import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { LlmContent } from '../ai-agents/llm/llm.types';
import { SAKANA_SIMPLE_MODEL } from '../ai-agents/llm/llm.constants';
import { VOUCHER_EXTRACT_SYSTEM_PROMPT } from './voucher.prompts';
import {
  AcceptanceItem,
  AcceptancePassenger,
  ExtractedVoucher,
} from './acceptances.types';

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

    return this.run(`<<<VOUCHER>>>\n${voucherText}\n<<<END>>>`, organizationId);
  }

  /**
   * Caminho de VISÃO: as páginas do voucher já rasterizadas em PNG, para o PDF
   * escaneado que não tem camada de texto.
   *
   * Usa o MESMO prompt e a MESMA temperatura 0 do caminho de texto de
   * propósito: as regras que importam (proibido deduzir, omitir campo ausente,
   * nunca incluir preço) valem igual. Um voucher lido errado por visão manda o
   * cliente ao parque no dia errado exatamente como um lido errado por texto.
   *
   * O modelo efetivo vem da chave de provedor da organização (que pode fixá-lo);
   * aqui não há escolha de modelo por caminho.
   */
  async extractFromImages(
    images: Buffer[],
    organizationId: string,
  ): Promise<ExtractedVoucher> {
    if (!images?.length) return EMPTY;

    return this.run(
      [
        {
          type: 'text' as const,
          text: 'As imagens a seguir são as páginas de um voucher escaneado. Leia o que está escrito nelas.',
        },
        ...images.map((png) => ({
          type: 'image' as const,
          // Base64 e não URL: estes PNGs são gerados em memória a partir do
          // PDF, não existem em lugar nenhum que o provedor possa baixar.
          base64: { mediaType: 'image/png', data: png.toString('base64') },
        })),
      ],
      organizationId,
    );
  }

  /** Chamada única ao LLM — o que muda entre texto e visão é só o conteúdo. */
  private async run(
    userContent: LlmContent,
    organizationId: string,
  ): Promise<ExtractedVoucher> {
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
          { role: 'user', content: userContent },
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

      const passengers = this.normalizePassengers(r.passengers);
      if (passengers.length) item.passengers = passengers;

      out.push(item);
    }
    return out;
  }

  /**
   * Passageiro sem `name` string não-vazia é descartado, não "corrigido": o
   * ingresso é nominal e uma linha em branco no comprovante vira discussão no
   * portão do parque. `birthDate` é opcional e só entra se vier como string —
   * qualquer outro tipo é lixo do modelo, e lixo aqui vira documento legal.
   */
  private normalizePassengers(raw: unknown): AcceptancePassenger[] {
    if (!Array.isArray(raw)) return [];
    const out: AcceptancePassenger[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const p = entry as Record<string, unknown>;
      if (typeof p.name !== 'string' || !p.name.trim()) continue;

      const passenger: AcceptancePassenger = { name: p.name.trim() };
      if (typeof p.birthDate === 'string' && p.birthDate.trim()) {
        passenger.birthDate = p.birthDate.trim();
      }
      out.push(passenger);
    }
    return out;
  }
}
