// Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
/**
 * CONFERÊNCIA DE FATO — a parte pura (sem rede, sem banco).
 *
 * A afirmação de FATO sobre o negócio ("o Epcot abre às 10h", "o ingresso
 * inclui 4 parques") é conferida contra a EVIDÊNCIA do run: as instruções e o
 * catálogo que foram no system prompt e o retorno das ferramentas chamadas.
 *
 *  1. Separa a resposta em FRASES e tira por regra simples o que não afirma
 *     nada: pergunta, saudação e link sozinho (um link é uma frase só).
 *  2. Três perguntas por frase (`claim_i`, `supported_i`, `contradicts_i`),
 *     respondidas pelo juiz com uma nota de 0 a 1.
 *  3. A decisão é em CÓDIGO, pelos limiares fixos daqui, e combinada pelo
 *     MÁXIMO das frases — nunca pela média: uma frase ruim não se perdoa com
 *     dez frases certas.
 *
 * Na Sendtur esta camada só OBSERVA: grava o veredito, nunca veta.
 */

/** `claim_i` ACIMA daqui = a frase afirma fato; `contradicts_i` ACIMA daqui = a base diz o contrário. */
export const LIMIAR_AFIRMACAO = 0.7;
/** `supported_i` ABAIXO daqui (com `claim_i` acima) = o fato não está na base. Igual não conta: é `<`. */
export const LIMIAR_SUPORTE = 0.3;
export const LIMIAR_CONTRADICAO = 0.7;

export type VereditoDaAfirmacao = 'passa' | 'contradiz' | 'nao_esta_na_base';

/** Notas do juiz por pergunta (`claim_0`, `supported_0`, ...), de 0 a 1. */
export type NotasDoJuiz = Readonly<Record<string, number | undefined>>;

// ── Degrau 1: as frases ─────────────────────────────────────────────────────

/** A URL é mascarada ANTES de fatiar: um link é uma frase só. */
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const FIM_DE_FRASE = /(?<=[.!?;…])\s+|\n+/;
const MARCADOR_DE_LISTA = /^\s*(?:[-*•●▪–—]|\d+[.)])\s*/;
const SOMENTE_LINK = /^(?:https?:\/\/|www\.)\S+$/i;
const LINK_MARCADO = /^\[[^\]]*\]\((?:https?:\/\/|www\.)[^)]+\)$/i;

/** Pergunta: termina em `?`. */
export function ehPergunta(frase: string): boolean {
  return /\?\s*$/.test(frase);
}

/** Saudação/agradecimento: lista fechada, sem adivinhação. */
export function ehSaudacao(frase: string): boolean {
  const semAcento = frase.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /^(?:oi|ola|opa|e ai|bom dia|boa tarde|boa noite|boa sorte|obrigad[oa]|valeu|fala|hello|hi|hey|thanks|thank you|tchau|falou)[.!…\s]*$/.test(
    semAcento,
  );
}

/** Um link sozinho não afirma fato nenhum. `Veja em https://…` fica. */
export function ehSomenteUmLink(frase: string): boolean {
  const compacta = frase.replace(/\s+/g, '');
  return SOMENTE_LINK.test(compacta) || LINK_MARCADO.test(compacta);
}

function saiPorRegraSimples(frase: string): boolean {
  return ehPergunta(frase) || ehSaudacao(frase) || ehSomenteUmLink(frase);
}

/** A resposta em frases conferíveis, na ordem em que aparecem. */
export function frasesParaConferir(resposta: string): string[] {
  const links: string[] = [];
  const mascarada = resposta.replace(LINK, (link) => {
    links.push(link);
    return `\u0000${links.length - 1}\u0000`;
  });
  return mascarada
    .split(FIM_DE_FRASE)
    .map((bruta) => bruta.replace(MARCADOR_DE_LISTA, '').trim())
    .filter((semLista) => semLista !== '')
    .map((semLista) =>
      semLista.replace(/\u0000(\d+)\u0000/g, (_t, i: string) => links[Number(i)] ?? '').trim(),
    )
    .filter((frase) => frase !== '' && !saiPorRegraSimples(frase));
}

// ── Degrau 2: as perguntas ao juiz ──────────────────────────────────────────

/** Três perguntas por frase, na ordem das frases. "Qualquer redação ou formato": "14h" ≡ "14:00". */
export function perguntasDaAfirmacao(frases: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    frases.flatMap((frase, i) => [
      [
        `claim_${i}`,
        `A frase "${frase}" afirma um fato sobre este negócio (horários, endereço, preços, ` +
          'características de produto ou serviço, disponibilidade, políticas)? Saudações, perguntas ' +
          'e frases genéricas de marketing não são fatos.',
      ],
      [
        `supported_${i}`,
        `O fato em "${frase}" está escrito nas EVIDÊNCIAS, em qualquer redação ou formato?`,
      ],
      [`contradicts_${i}`, `As EVIDÊNCIAS dizem algo que contradiz "${frase}"?`],
    ]),
  );
}

// ── Degrau 3: a decisão, em código ──────────────────────────────────────────

function probabilidade(nota: number | undefined): number | null {
  if (typeof nota !== 'number' || !Number.isFinite(nota)) return null;
  return nota >= 0 && nota <= 1 ? nota : null;
}

const GRAVIDADE: Record<VereditoDaAfirmacao, number> = { passa: 0, nao_esta_na_base: 1, contradiz: 2 };

export interface ResultadoDoCalculo {
  /** Nota ausente ou fora de 0–1: não dá para decidir (vira "não conferido"). */
  ilegivel: boolean;
  /** `null` quando `ilegivel`. */
  veredito: VereditoDaAfirmacao | null;
  /** A frase que decidiu o veredito (null quando passa). */
  frase: string | null;
}

// ── Corroboração mecânica da paráfrase ──────────────────────────────────────
//
// O juiz casa com o texto LITERAL da evidência: quem junta dois itens da
// mesma linha ("Flexível R$ 119,90 · Fosca R$ 119,90" → "Flexível ou fosca:
// R$ 119,90") cairia em `nao_esta_na_base` com o preço na evidência. Antes de
// marcar "fora da base", confere o que é MECÂNICO: o preço normalizado e o
// nome de CADA item existem na evidência. Só resgata `nao_esta_na_base`.

/** Um valor no texto: `R$ 1.234,56` / `119.90` / `8h` — inteiro + decimais opcionais. */
const VALOR = /(?<![\p{L}\p{N}])(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?![\p{L}\p{N}%])/giu;

/** `R$ 119,90` ≡ `119,90` ≡ `119.90` → `119.90`. */
function canonico(inteiro: string, decimais: string | undefined): string {
  const semSeparador = inteiro.replace(/[.,]/g, '');
  return decimais === undefined ? semSeparador : `${semSeparador}.${decimais}`;
}

interface ValorEncontrado {
  valor: string;
  /** O trecho ANTERIOR ao valor (desde o valor anterior): é ali que mora o nome do item. */
  rotulo: string;
}

function valoresComRotulo(texto: string): ValorEncontrado[] {
  const achados = [...texto.matchAll(VALOR)];
  return achados.map((m, i) => {
    const anterior = achados[i - 1];
    const inicio = anterior ? (anterior.index ?? 0) + anterior[0].length : 0;
    const rotulo = texto.slice(inicio, m.index);
    // O nome do item não atravessa os separadores de lista da evidência.
    const corte = Math.max(
      rotulo.lastIndexOf('\n'),
      rotulo.lastIndexOf('·'),
      rotulo.lastIndexOf(';'),
      rotulo.lastIndexOf('|'),
    );
    return { valor: canonico(m[1] ?? '', m[2]), rotulo: rotulo.slice(corte + 1) };
  });
}

/** `"Flexível ou fosca: "` → `["Flexível", "fosca:"]`. */
function itensDoRotulo(rotulo: string): string[] {
  return rotulo
    .split(/[·/|,;+()]|\s+\bou\b/i)
    .map((pedaco) => pedaco.trim())
    .filter((pedaco) => pedaco !== '');
}

/** A cola que qualquer frase de preço põe em volta do item — não é nome de produto. */
const COLA_DO_ITEM: ReadonlySet<string> = new Set([
  'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'num', 'numa', 'pelo', 'pela', 'pelos', 'pelas',
  'por', 'para', 'com', 'sem', 'sobre', 'entre', 'e', 'ou', 'mas', 'que', 'se',
  'ao', 'aos', 'ate',
  'sai', 'saiem', 'custa', 'custam', 'vale', 'valem', 'fica', 'ficam', 'tem',
  'temos', 'sera', 'sao', 'esta',
]);

/** Tokens normalizados (minúsculo, sem acento) com 2+ caracteres. */
function tokens(texto: string): Set<string> {
  const limpo = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set(limpo.split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
}

function tokensDoItem(item: string): string[] {
  return [...tokens(item)].filter((t) => !COLA_DO_ITEM.has(t));
}

/** Nome no item × nome no trecho: exato, plural ou inflexão curta (nunca prefixo qualquer). */
function nomeBate(item: string, trecho: ReadonlySet<string>): boolean {
  if (trecho.has(item)) return true;
  if (item.length < 4) return false;
  const semS = item.endsWith('s') ? item.slice(0, -1) : item;
  return [...trecho].some((nome) => {
    if (nome.length < 4) return false;
    const outro = nome.endsWith('s') ? nome.slice(0, -1) : nome;
    if (outro === semS) return true;
    const folga = Math.abs(outro.length - semS.length);
    return folga <= 2 && (outro.startsWith(semS) || semS.startsWith(outro));
  });
}

/**
 * A frase tem BASE MECÂNICA na evidência? Para CADA preço da frase: o mesmo
 * preço (canônico) num trecho da evidência e o nome de CADA item naquele
 * trecho. Frase sem número → `false`.
 */
export function temBaseNumerica(frase: string, evidencia: string): boolean {
  const alvos = valoresComRotulo(frase);
  const trechos = valoresComRotulo(evidencia);
  if (alvos.length === 0 || trechos.length === 0) return false;
  const todosProvados = alvos.every(({ valor, rotulo }) => {
    const bolsas = trechos.filter((t) => t.valor === valor).map((t) => tokens(t.rotulo));
    if (bolsas.length === 0) return false;
    const itens = itensDoRotulo(rotulo)
      .map(tokensDoItem)
      .filter((nomes) => nomes.length > 0);
    // Preço sem item nomeado ("Sai por R$ 119,90") não amarra a nada.
    if (itens.length === 0) return false;
    return itens.every((nomes) => bolsas.some((b) => nomes.every((n) => nomeBate(n, b))));
  });
  if (!todosProvados) return false;
  // O que vem depois do último preço não foi conferido ("… e tem frete grátis").
  const ultimo = [...frase.matchAll(VALOR)].at(-1);
  const cauda = ultimo ? frase.slice((ultimo.index ?? 0) + ultimo[0].length) : '';
  return tokensDoItem(cauda).length === 0;
}

function vereditoDaFrase(
  frase: string,
  claim: number,
  supported: number,
  contradicts: number,
  evidencia: string | undefined,
): VereditoDaAfirmacao {
  if (contradicts > LIMIAR_CONTRADICAO) return 'contradiz';
  if (claim > LIMIAR_AFIRMACAO && supported < LIMIAR_SUPORTE) {
    return evidencia !== undefined && temBaseNumerica(frase, evidencia) ? 'passa' : 'nao_esta_na_base';
  }
  return 'passa';
}

/**
 * O pior veredito entre as frases. Nota ausente ou fora de 0–1 é `ilegivel`.
 * `evidencia` alimenta a corroboração mecânica de preço.
 */
export function decidirAfirmacoes(
  frases: readonly string[],
  notas: NotasDoJuiz,
  evidencia?: string,
): ResultadoDoCalculo {
  const porFrase = frases.map((frase, i) => ({
    frase,
    claim: probabilidade(notas[`claim_${i}`]),
    supported: probabilidade(notas[`supported_${i}`]),
    contradicts: probabilidade(notas[`contradicts_${i}`]),
  }));
  if (porFrase.some((f) => f.claim === null || f.supported === null || f.contradicts === null)) {
    return { ilegivel: true, veredito: null, frase: null };
  }
  return porFrase.reduce<ResultadoDoCalculo>(
    (pior, f) => {
      const desta = vereditoDaFrase(f.frase, f.claim ?? 0, f.supported ?? 0, f.contradicts ?? 0, evidencia);
      const atual = pior.veredito ?? 'passa';
      return GRAVIDADE[desta] > GRAVIDADE[atual] ? { ilegivel: false, veredito: desta, frase: f.frase } : pior;
    },
    { ilegivel: false, veredito: 'passa', frase: null },
  );
}
