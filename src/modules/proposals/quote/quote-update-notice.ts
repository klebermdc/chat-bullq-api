import { extractVariables, firstName, type HsmTemplateRow } from '../../scheduling/hsm-template-payload';
import { formatQuoteNumber } from './quote-proposal';

/**
 * Template HSM do aviso "atualizei sua cotação", usado quando a janela de
 * texto livre está fechada. Precisa estar aprovado com este nome em cada
 * número que manda cotação. Corpo: {{1}} primeiro nome, {{2}} número, {{3}} link.
 */
export const QUOTE_UPDATED_TEMPLATE = 'cotacao_atualizada';

/** Saudação quando a cotação não tem nome: "Oi, tudo bem!". */
const NO_NAME = 'tudo bem';

/**
 * Como o aviso saiu: texto (janela aberta), template (janela fechada) ou não
 * saiu (janela fechada e template não aprovado no número). OFF = atendente
 * desmarcou o aviso.
 */
export type QuoteNotice = 'TEXT' | 'TEMPLATE' | 'NO_TEMPLATE' | 'OFF';

export interface QuoteNoticeValues {
  customerName: string | null;
  quoteNumber: number | null;
  url: string;
}

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' ? (value as Record<string, any>) : {};

/**
 * Payload do template para `MessagesService.send` (type TEMPLATE), ou null se
 * o template cadastrado tiver cabeçalho de mídia (não há o que pôr nele).
 */
export function quoteUpdatedTemplateContent(template: HsmTemplateRow, values: QuoteNoticeValues): Record<string, any> | null {
  const components = asRecord(template.components);
  if (asRecord(components.header).format && asRecord(components.header).format !== 'TEXT') return null;

  const byVar: Record<string, string> = {
    '1': firstName(values.customerName) || NO_NAME,
    '2': values.quoteNumber ? formatQuoteNumber(values.quoteNumber) : '-',
    '3': values.url,
  };
  const vars = extractVariables(String(asRecord(components.body).text ?? ''));
  const payload: Record<string, any> = { name: template.name, language: { code: template.language } };
  if (vars.length > 0) {
    payload.components = [{ type: 'body', parameters: vars.map((n) => ({ type: 'text', text: byVar[n] ?? '-' })) }];
  }
  return payload;
}
