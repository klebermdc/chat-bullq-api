/**
 * Ficha que a Aline deixa ao passar a conversa para o vendedor. Fica em
 * `conversation.metadata.handoffBrief` e o web mostra fixa acima do campo de
 * mensagem, para o vendedor responder sem reler a conversa inteira.
 *
 * Antes o resumo ia só para Contact.notes, colado no fim das observações
 * antigas, num painel lateral fechado por padrão — na prática ninguém via.
 */
export interface HandoffBrief {
  summary?: string;
  destination?: string;
  travelDates?: string;
  travelers?: string;
  budget?: string;
  pendingQuestions?: string;
  at: string;
}

export const HANDOFF_BRIEF_LIMITS = { summary: 1000, field: 300 } as const;

const STRUCTURED_FIELDS = [
  'destination',
  'travelDates',
  'travelers',
  'budget',
  'pendingQuestions',
] as const;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

/** Monta a ficha a partir dos argumentos da tool; null se não houver nada. */
export function buildHandoffBrief(
  input: Record<string, unknown>,
  now: Date,
): HandoffBrief | null {
  const summary = cleanText(input.summary, HANDOFF_BRIEF_LIMITS.summary);
  const fields = Object.fromEntries(
    STRUCTURED_FIELDS.map((key) => [key, cleanText(input[key], HANDOFF_BRIEF_LIMITS.field)])
      .filter(([, value]) => value !== undefined),
  ) as Omit<HandoffBrief, 'at' | 'summary'>;

  if (!summary && Object.keys(fields).length === 0) return null;
  return { ...(summary ? { summary } : {}), ...fields, at: now.toISOString() };
}
