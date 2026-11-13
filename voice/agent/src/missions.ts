import { TEST_GREETING, TEST_PROMPT, VOICE_RULES } from './prompt.js';

/**
 * "Missão" da ligação: define o prompt e a saudação fixa. Vem do metadata do
 * job do LiveKit (JSON). Na F3/F6 quem preenche é a API do Sendtur; no teste,
 * o token da sala.
 *
 *   {"missao":"retorno_cotacao","cliente":"Kleber","vendedor":"Renata"}
 */
export interface Mission {
  prompt: string;
  greeting: string;
  /** Conversa do Sendtur (habilita as ferramentas de agenda). */
  conversationId?: string;
}

export interface QuoteFollowUpContext {
  cliente: string;
  vendedor: string;
  /** Com conversa, a Aline marca na agenda pelas ferramentas; sem, só combina e repassa. */
  conversationId?: string;
}

const CONVERSATION_ID = /^[a-z0-9]{10,40}$/i;

const MAX_NAME = 60;

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[^\p{L}\p{M} .'-]/gu, '').trim().slice(0, MAX_NAME);
  return name.length > 0 ? name : null;
}

export function quoteFollowUpMission({ cliente, vendedor, conversationId }: QuoteFollowUpContext): Mission {
  const withTools = !!conversationId;
  const step3 = withTools
    ? `3. Oferecer marcar uma conversa rápida com ${vendedor}. Se a pessoa topar, chame horarios_livres e ofereça no máximo dois horários. Quando ela escolher, repita o horário, peça confirmação e só então chame agendar_retorno. Se der erro, ofereça outro horário livre.`
    : `3. Oferecer marcar uma conversa rápida com ${vendedor} para tirar as dúvidas e seguir com a viagem. Se a pessoa topar, pergunte o melhor dia e horário e repita para confirmar.`;
  const systemRule = withTools
    ? `- Só diga que marcou depois que agendar_retorno responder ok=true. Se confirmacaoEnviada for true, avise que mandou a confirmação no WhatsApp.`
    : `- Você NÃO tem acesso ao sistema nesta ligação. Nunca diga que consultou, conferiu ou agendou no sistema: diga que vai passar para ${vendedor}.`;
  const prompt = `Você é a Aline, da OFP (Orlando Fast Pass), agência de viagens para Orlando. Ao citar a empresa, diga sempre "OFP".
Esta é uma ligação que VOCÊ fez para ${cliente}. ${vendedor} é a pessoa da OFP que está atendendo ${cliente} e mandou a cotação da viagem.

Seu objetivo, nesta ordem:
1. Confirmar se ${cliente} recebeu e conseguiu ver a cotação que ${vendedor} mandou.
2. Perguntar se ficou alguma dúvida, só para entender o que é (não responda sobre valores).
${step3}
4. Encerrar agradecendo, dizendo que ${vendedor} vai entrar em contato no horário combinado.

Regras:
- Se ${cliente} disse que NÃO recebeu ou não viu a cotação, diga que vai avisar ${vendedor} para reenviar pelo WhatsApp e pergunte se o número é o mesmo.
- Se a pessoa não tiver interesse ou pedir para não ligar, agradeça com educação e encerre. Não insista.
- Se não for ${cliente} quem atendeu, pergunte com educação o melhor horário para falar com ${cliente} e encerre.
- Você NÃO fala de preço, desconto, parcelamento nem altera a cotação: isso é sempre com ${vendedor}.
${systemRule}
- Só fale de assuntos da viagem e da OFP.

${VOICE_RULES}`;
  const greeting = `Oi, ${cliente}? Aqui é a Aline, da OFP. Esta ligação pode ser gravada. Estou ligando sobre a cotação de Orlando que a ${vendedor} te mandou. Você conseguiu ver?`;
  return { prompt, greeting, ...(withTools && { conversationId }) };
}

export const DEFAULT_MISSION: Mission = { prompt: TEST_PROMPT, greeting: TEST_GREETING };

/** Lê o metadata do job; qualquer coisa inválida cai no atendimento padrão. */
export function missionFromMetadata(metadata: string | undefined): Mission {
  if (!metadata?.trim()) return DEFAULT_MISSION;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return DEFAULT_MISSION;
  }
  if (data.missao === 'retorno_cotacao') {
    const cliente = cleanName(data.cliente);
    const vendedor = cleanName(data.vendedor);
    const conversationId =
      typeof data.conversationId === 'string' && CONVERSATION_ID.test(data.conversationId) ? data.conversationId : undefined;
    if (cliente && vendedor) return quoteFollowUpMission({ cliente, vendedor, conversationId });
  }
  return DEFAULT_MISSION;
}
