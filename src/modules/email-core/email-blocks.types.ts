export type EmailBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'button'; label: string; href: string }
  | { type: 'divider' };

export interface EmailContent {
  blocks: EmailBlock[];
}

/** Variáveis disponíveis em `{{...}}` dentro de heading/text/button. */
export interface EmailVariables {
  nome?: string;
  email: string;
}

const KNOWN_TYPES = ['heading', 'text', 'image', 'button', 'divider'];

/**
 * Valida o JSON vindo da API. Roda no save da campanha, não no envio — conteúdo
 * inválido tem que barrar antes de virar mil linhas em `email_messages`.
 */
export function parseEmailContent(raw: unknown): EmailContent {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).blocks)) {
    throw new Error('conteúdo inválido: esperado { blocks: [...] }');
  }
  const blocks = (raw as any).blocks as unknown[];
  if (!blocks.length) throw new Error('conteúdo inválido: pelo menos um bloco é obrigatório');

  blocks.forEach((b, i) => {
    const block = b as any;
    if (!block || typeof block.type !== 'string' || !KNOWN_TYPES.includes(block.type)) {
      throw new Error(`bloco ${i}: tipo desconhecido "${block?.type}"`);
    }
    if ((block.type === 'heading' || block.type === 'text') && !block.text?.trim()) {
      throw new Error(`bloco ${i}: "${block.type}" exige texto`);
    }
    if (block.type === 'image' && !block.src?.trim()) {
      throw new Error(`bloco ${i}: "image" exige src`);
    }
    if (block.type === 'button' && (!block.label?.trim() || !block.href?.trim())) {
      throw new Error(`bloco ${i}: "button" exige label e href`);
    }
  });

  return { blocks: blocks as EmailBlock[] };
}

/** Substitui `{{nome}}` e `{{email}}`. Placeholder desconhecido vira string vazia. */
export function applyVariables(text: string, vars: EmailVariables): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  });
}
