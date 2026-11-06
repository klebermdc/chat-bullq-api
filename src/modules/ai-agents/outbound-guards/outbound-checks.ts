/**
 * Peças puras das travas de saída usadas pelo replyToConversation, pela
 * transferToHuman e pelo runner: quem conta como "acionou uma pessoa", as
 * mensagens de veto que ensinam o modelo a reescrever e o texto de evidência
 * do run.
 */
import type { LlmContent } from '../llm/llm.types';
import type { ToolContext } from '../tools/tool.types';
import type { PriorToolCall } from './send-check.types';
import { contemAssuntoComercialNaSaida } from './commercial-topic';

/** Ferramentas que acionam de verdade uma pessoa (transferência ou recado ao vendedor). */
export const HUMAN_ACTION_TOOLS: ReadonlySet<string> = new Set([
  'transferToHuman',
  'leaveNoteForSeller',
]);

/** Alguma ferramenta que aciona uma pessoa já funcionou neste run? */
export function hasHumanAction(priorToolCalls: ReadonlyArray<PriorToolCall>): boolean {
  return priorToolCalls.some((c) => c.ok && HUMAN_ACTION_TOOLS.has(c.name));
}

/**
 * Contexto para a mensagem que a própria ferramenta de ação manda (ex.: o
 * aviso de transição da transferToHuman): marca a ação como feita e tira a
 * evidência, porque texto montado pelo sistema não passa por conferência de fato.
 */
export function withHumanActionTaken(ctx: ToolContext, toolName: string): ToolContext {
  return {
    ...ctx,
    outboundGuards: {
      priorToolCalls: [...(ctx.outboundGuards?.priorToolCalls ?? []), { name: toolName, ok: true }],
    },
  };
}

export const COMMERCIAL_VETO_MESSAGE =
  'Mensagem bloqueada: valores e negociação são só com o consultor. Não mencione preço, valor, desconto, ' +
  'parcela, Pix nem forma de pagamento (nem preço de tabela). ANTES de responder, registre o pedido para o ' +
  'vendedor com transferToHuman (ou leaveNoteForSeller, no plantão). A transferToHuman já avisa o cliente ' +
  'sozinha; com leaveNoteForSeller, diga ao cliente apenas que o consultor vai tratar disso com ele.';

export const LINK_VETO_MESSAGE =
  'Mensagem bloqueada: você não envia link nenhum ao cliente (nem site, nem cotação, nem pagamento). ' +
  'Reescreva sem link, respondendo a dúvida com suas palavras. Se o cliente precisa de cotação, valores ' +
  'ou link de compra, registre para o vendedor com transferToHuman (ou leaveNoteForSeller, no plantão) ' +
  'ANTES de responder.';

export const HUMAN_PROMISE_VETO_MESSAGE =
  'Mensagem bloqueada: você prometeu que o consultor, o vendedor ou a equipe vai agir, mas neste atendimento ' +
  'ninguém foi acionado. Se o cliente precisa mesmo de uma pessoa, chame transferToHuman (ou ' +
  'leaveNoteForSeller, no plantão) ANTES de responder; a transferToHuman já avisa o cliente sozinha. Se não ' +
  'precisa, reescreva sem prometer contato, retorno ou ação de outra pessoa.';

/** Códigos de bloqueio das travas de saída novas (sem assunto comercial / promessa sem ação). */
export const OUTBOUND_BLOCK_ERRORS: ReadonlySet<string> = new Set([
  'commercial_talk_blocked',
  'link_blocked',
  'human_promise_without_action',
]);

/** A instrução do veto, se o retorno do replyToConversation for um bloqueio das travas novas. */
export function outboundVetoFrom(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const { error, message } = output as { error?: unknown; message?: unknown };
  if (typeof error !== 'string' || !OUTBOUND_BLOCK_ERRORS.has(error)) return null;
  return typeof message === 'string' ? message : null;
}

/**
 * Quando o texto solto do modelo (fallback do runner) cai numa trava, o modelo
 * não vê retorno de ferramenta: o runner devolve o veto como lembrete, uma vez.
 */
export function fallbackRetryText(veto: string): string {
  return (
    `Sua última mensagem NÃO foi enviada ao cliente. ${veto} ` +
    'Responda de novo usando as ferramentas (replyToConversation, ou a ação indicada acima).'
  );
}

/** Ferramentas que só servem para vender (preço, condição, link): somem com `blockCommercialTalk`. */
export const COMMERCIAL_ONLY_TOOLS: ReadonlySet<string> = new Set(['lookupOffering']);

/** A ferramenta fica de fora por causa da regra comercial da org? */
export function isToolBlockedByCommercialRule(name: string, blockCommercialTalk: boolean): boolean {
  return blockCommercialTalk && COMMERCIAL_ONLY_TOOLS.has(name);
}

/** As ferramentas oferecidas ao modelo, sem as de venda quando a regra está ligada. */
export function toolsForCommercialRule<T extends { name: string }>(
  tools: readonly T[],
  blockCommercialTalk: boolean,
): T[] {
  return tools.filter((t) => !isToolBlockedByCommercialRule(t.name, blockCommercialTalk));
}

/**
 * A cutucada de vendas do runner (rodou lookupOffering/checkPurchase e não
 * respondeu). Com `blockCommercialTalk` ela não existe: a IA só qualifica.
 */
export function shouldSendSalesNudge(input: {
  calledSalesPrep: boolean;
  neverReplied: boolean;
  stillNoAction: boolean;
  nudgeUsed: boolean;
  blockCommercialTalk: boolean;
}): boolean {
  return (
    !input.blockCommercialTalk &&
    input.calledSalesPrep &&
    input.neverReplied &&
    input.stillNoAction &&
    !input.nudgeUsed
  );
}

/** Catálogo sem preço: a descrição curta que fala de valor some (o nome fica). */
export function catalogWithoutPrices<T extends { shortLine: string }>(catalog: readonly T[]): T[] {
  return catalog.map((p) =>
    contemAssuntoComercialNaSaida(p.shortLine ?? '') ? { ...p, shortLine: '' } : p,
  );
}

function textOf(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter((t) => t !== '')
    .join('\n');
}

/**
 * Evidência do run para a conferência de fato: a camada de segurança + o
 * system prompt montado pelo builder (persona, instruções, catálogo, skills).
 * Chamado ANTES do RAG entrar no system: o RAG é memória da conversa, não fato do negócio.
 */
export function promptEvidenceFrom(securityText: string, systemContent: LlmContent): string {
  return [securityText, textOf(systemContent)].filter((t) => t !== '').join('\n\n');
}
