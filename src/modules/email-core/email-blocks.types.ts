export type SocialNetwork = 'instagram' | 'whatsapp' | 'facebook' | 'site';
export type SpacerSize = 'sm' | 'md' | 'lg';
export type BlockAlign = 'left' | 'center' | 'right';
export type FontFamily = 'sans' | 'serif';

/**
 * Estilo opcional por bloco. Vazio significa "usa o tema".
 *
 * O conjunto foi escolhido entre propriedades que renderizam largamente em
 * cliente de email. `borderRadius` é a exceção conhecida: funciona em Gmail,
 * Apple Mail e celular, mas o Outlook desktop usa o motor do Word e ignora —
 * o botão sai reto. Está aqui porque a degradação é aceitável e o editor avisa.
 */
export interface BlockStyle {
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  bold?: boolean;
  align?: BlockAlign;
  paddingY?: number;
  buttonColor?: string;
  buttonTextColor?: string;
  borderRadius?: number;
}

export interface EmailTheme {
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  containerColor: string;
  fontFamily: FontFamily;
}

export const DEFAULT_THEME: EmailTheme = {
  primaryColor: '#7c3aed',
  textColor: '#18181b',
  backgroundColor: '#f4f4f5',
  containerColor: '#ffffff',
  fontFamily: 'sans',
};

type WithStyle<T> = T & { style?: BlockStyle };

export type EmailBlock =
  | WithStyle<{ type: 'heading'; text: string }>
  | WithStyle<{ type: 'text'; text: string }>
  | WithStyle<{ type: 'image'; src: string; alt?: string }>
  | WithStyle<{ type: 'button'; label: string; href: string }>
  | WithStyle<{ type: 'divider' }>
  | WithStyle<{ type: 'logo'; src: string; href?: string; alt?: string }>
  | WithStyle<{ type: 'spacer'; size: SpacerSize }>
  | WithStyle<{
      type: 'offer';
      src?: string;
      title: string;
      price?: string;
      label: string;
      href: string;
    }>
  | WithStyle<{ type: 'social'; links: Array<{ network: SocialNetwork; href: string }> }>;

export interface EmailContent {
  theme: EmailTheme;
  blocks: EmailBlock[];
}

export interface EmailVariables {
  nome?: string;
  email: string;
}

const KNOWN_TYPES = [
  'heading', 'text', 'image', 'button', 'divider',
  'logo', 'spacer', 'offer', 'social',
];
const SPACER_SIZES: SpacerSize[] = ['sm', 'md', 'lg'];
const ALIGNS: BlockAlign[] = ['left', 'center', 'right'];
const NETWORKS: SocialNetwork[] = ['instagram', 'whatsapp', 'facebook', 'site'];
const FONTS: FontFamily[] = ['sans', 'serif'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 64;
const MAX_PADDING = 96;
const MAX_RADIUS = 32;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseTheme(raw: unknown): EmailTheme {
  if (raw === undefined || raw === null) return { ...DEFAULT_THEME };
  assert(typeof raw === 'object', 'tema inválido: esperado objeto');
  const t = raw as Record<string, unknown>;

  for (const key of ['primaryColor', 'textColor', 'backgroundColor', 'containerColor'] as const) {
    if (t[key] !== undefined) {
      assert(typeof t[key] === 'string' && HEX.test(t[key] as string), `tema: ${key} precisa ser cor hexadecimal (#rrggbb)`);
    }
  }
  if (t.fontFamily !== undefined) {
    assert(FONTS.includes(t.fontFamily as FontFamily), `tema: fontFamily precisa ser ${FONTS.join(' ou ')}`);
  }
  // Tema parcial é completado com os padrões: quem só quer trocar a cor do
  // botão não deveria ser obrigado a redeclarar o resto.
  return { ...DEFAULT_THEME, ...(t as Partial<EmailTheme>) };
}

function parseStyle(raw: unknown, i: number): BlockStyle | undefined {
  if (raw === undefined || raw === null) return undefined;
  assert(typeof raw === 'object', `bloco ${i}: style inválido`);
  const s = raw as Record<string, unknown>;

  for (const key of ['color', 'backgroundColor', 'buttonColor', 'buttonTextColor'] as const) {
    if (s[key] !== undefined) {
      assert(typeof s[key] === 'string' && HEX.test(s[key] as string), `bloco ${i}: style.${key} precisa ser cor hexadecimal (#rrggbb)`);
    }
  }
  if (s.fontSize !== undefined) {
    const n = s.fontSize;
    assert(typeof n === 'number' && n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE, `bloco ${i}: style.fontSize precisa estar entre ${MIN_FONT_SIZE} e ${MAX_FONT_SIZE}`);
  }
  if (s.paddingY !== undefined) {
    const n = s.paddingY;
    assert(typeof n === 'number' && n >= 0 && n <= MAX_PADDING, `bloco ${i}: style.paddingY fora da faixa`);
  }
  if (s.borderRadius !== undefined) {
    const n = s.borderRadius;
    assert(typeof n === 'number' && n >= 0 && n <= MAX_RADIUS, `bloco ${i}: style.borderRadius fora da faixa`);
  }
  if (s.align !== undefined) {
    assert(ALIGNS.includes(s.align as BlockAlign), `bloco ${i}: style.align precisa ser ${ALIGNS.join(', ')}`);
  }
  if (s.bold !== undefined) {
    assert(typeof s.bold === 'boolean', `bloco ${i}: style.bold precisa ser booleano`);
  }
  return s as BlockStyle;
}

/**
 * Valida o JSON vindo da API. Roda no save da campanha, não no envio —
 * conteúdo inválido tem que barrar antes de virar mil linhas em `email_messages`.
 */
export function parseEmailContent(raw: unknown): EmailContent {
  assert(raw && typeof raw === 'object' && Array.isArray((raw as any).blocks), 'conteúdo inválido: esperado { blocks: [...] }');
  const blocks = (raw as any).blocks as unknown[];
  assert(blocks.length, 'conteúdo inválido: pelo menos um bloco é obrigatório');

  const theme = parseTheme((raw as any).theme);

  blocks.forEach((b, i) => {
    const block = b as any;
    assert(block && typeof block.type === 'string' && KNOWN_TYPES.includes(block.type), `bloco ${i}: tipo desconhecido "${block?.type}"`);
    parseStyle(block.style, i);

    switch (block.type) {
      case 'heading':
      case 'text':
        assert(block.text?.trim(), `bloco ${i}: "${block.type}" exige texto`);
        break;
      case 'image':
        assert(block.src?.trim(), `bloco ${i}: "image" exige src`);
        break;
      case 'button':
        assert(block.label?.trim() && block.href?.trim(), `bloco ${i}: "button" exige label e href`);
        break;
      case 'logo':
        assert(block.src?.trim(), `bloco ${i}: "logo" exige src`);
        break;
      case 'spacer':
        assert(SPACER_SIZES.includes(block.size), `bloco ${i}: "spacer" exige size entre ${SPACER_SIZES.join(', ')}`);
        break;
      case 'offer':
        assert(block.title?.trim(), `bloco ${i}: "offer" exige title`);
        assert(block.label?.trim(), `bloco ${i}: "offer" exige label do botão`);
        // Sem link o card não leva a lugar nenhum — é o ponto inteiro dele.
        assert(block.href?.trim(), `bloco ${i}: "offer" exige href`);
        break;
      case 'social':
        assert(Array.isArray(block.links) && block.links.length, `bloco ${i}: "social" exige pelo menos um link`);
        block.links.forEach((l: any, j: number) => {
          assert(NETWORKS.includes(l?.network), `bloco ${i}, link ${j}: rede desconhecida "${l?.network}"`);
          assert(l.href?.trim(), `bloco ${i}, link ${j}: exige href`);
        });
        break;
    }
  });

  return { theme, blocks: blocks as EmailBlock[] };
}

/** Substitui `{{nome}}` e `{{email}}`. Placeholder desconhecido vira string vazia. */
export function applyVariables(text: string, vars: EmailVariables): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = (vars as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  });
}
