/**
 * Peças puras das travas de saída usadas pelo replyToConversation, pela
 * transferToHuman e pelo runner: quem conta como "acionou uma pessoa", as
 * mensagens de veto que ensinam o modelo a reescrever e o texto de evidência
 * do run.
 */
import type { LlmContent } from '../llm/llm.types';
import type { ToolContext } from '../tools/tool.types';
import type { PriorToolCall } from './send-check.types';

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

export const HUMAN_PROMISE_VETO_MESSAGE =
  'Mensagem bloqueada: você prometeu que o consultor, o vendedor ou a equipe vai agir, mas neste atendimento ' +
  'ninguém foi acionado. Se o cliente precisa mesmo de uma pessoa, chame transferToHuman (ou ' +
  'leaveNoteForSeller, no plantão) ANTES de responder; a transferToHuman já avisa o cliente sozinha. Se não ' +
  'precisa, reescreva sem prometer contato, retorno ou ação de outra pessoa.';

/** Códigos de bloqueio das travas de saída novas (sem assunto comercial / promessa sem ação). */
export const OUTBOUND_BLOCK_ERRORS: ReadonlySet<string> = new Set([
  'commercial_talk_blocked',
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

/**
 * Lembrete do runner quando o modelo rodou lookupOffering/checkPurchase e não
 * respondeu. Com `blockCommercialTalk`, não pede preço: valores são do consultor.
 */
export function salesNudgeText(blockCommercialTalk: boolean): string {
  const pedido = blockCommercialTalk
    ? '1 frase de pitch ligada à dor + link (vindo do lookupOffering). NÃO fale de preço, valor, parcela ou pagamento: isso é com o consultor.'
    : '1 frase de pitch ligada à dor + preço + link do checkout (vindos do lookupOffering).';
  return (
    'Você rodou as tools de preparação (lookupOffering / checkPurchase) mas não chamou replyToConversation. ' +
    `O cliente está esperando. Responda agora com replyToConversation: ${pedido} ` +
    'Não termine este turn sem chamar replyToConversation.'
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
