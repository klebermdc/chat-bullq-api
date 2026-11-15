/**
 * Valor em reais por extenso, em código — a IA nunca escreve o extenso de um
 * contrato (um dígito trocado vira cláusula errada). Funções puras.
 */

/** Teto: 999.999.999.999,99. Contrato de viagem não passa nem perto. */
const MAX_CENTS = 99_999_999_999_999;

const UNITS = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
] as const;
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'] as const;
const HUNDREDS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
] as const;

/** [singular, plural] de cada grupo de 3 dígitos, do menor para o maior. */
const SCALES = [
  ['', ''],
  ['mil', 'mil'],
  ['milhão', 'milhões'],
  ['bilhão', 'bilhões'],
] as const;

const THOUSAND = 1000;
const MILLION = 1_000_000;

// "8.500,00" / "8.500" / "1.234.567,8"
const BR_GROUPED_RE = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/;
// "8500,00" / "8500"
const BR_PLAIN_RE = /^\d+(?:,\d{1,2})?$/;
// "8500.00" — ponto com exatamente 2 casas só pode ser decimal.
const DOT_DECIMAL_RE = /^\d+\.\d{2}$/;

/** Centavos de um valor em reais ("R$ 8.500,00" → 850000); null se não for dinheiro. */
export function parseBrl(text: string): number | null {
  const raw = (text ?? '').replace(/^\s*R\$\s*/i, '').replace(/\s+/g, '').trim();
  if (!raw) return null;
  let normalized: string | null = null;
  if (BR_GROUPED_RE.test(raw)) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (BR_PLAIN_RE.test(raw)) normalized = raw.replace(',', '.');
  else if (DOT_DECIMAL_RE.test(raw)) normalized = raw;
  if (normalized === null) return null;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isFinite(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** 0–999 por extenso. */
function hundredsToWords(n: number): string {
  if (n < 20) return UNITS[n];
  if (n < 100) {
    const unit = n % 10;
    return unit ? `${TENS[Math.floor(n / 10)]} e ${UNITS[unit]}` : TENS[n / 10];
  }
  if (n === 100) return 'cem';
  const rest = n % 100;
  const head = HUNDREDS[Math.floor(n / 100)];
  return rest ? `${head} e ${hundredsToWords(rest)}` : head;
}

function groupToWords(value: number, scale: number): string {
  if (scale === 1) return value === 1 ? 'mil' : `${hundredsToWords(value)} mil`;
  if (scale === 0) return hundredsToWords(value);
  const [singular, plural] = SCALES[scale];
  return `${hundredsToWords(value)} ${value === 1 ? singular : plural}`;
}

/** Inteiro por extenso ("1500" → "mil e quinhentos"). */
export function integerToWords(n: number): string {
  if (n === 0) return UNITS[0];
  const groups = [];
  for (let rest = n, scale = 0; rest > 0; rest = Math.floor(rest / THOUSAND), scale += 1) {
    groups.push({ value: rest % THOUSAND, scale });
  }
  const parts = groups.filter((g) => g.value > 0).reverse();
  return parts
    .map((g, index) => {
      const words = groupToWords(g.value, g.scale);
      if (index === 0) return words;
      // "e" só antes do último grupo, quando ele é < 100 ou centena redonda.
      const isLast = index === parts.length - 1;
      const joinWithE = isLast && (g.value < 100 || g.value % 100 === 0);
      return `${joinWithE ? 'e ' : ''}${words}`;
    })
    .join(' ');
}

function reaisToWords(reais: number): string {
  if (reais === 1) return 'um real';
  // "um milhão de reais", mas "um milhão e quinhentos mil reais".
  const preposition = reais >= MILLION && reais % MILLION === 0 ? ' de' : '';
  return `${integerToWords(reais)}${preposition} reais`;
}

function centsToWords(cents: number): string {
  return cents === 1 ? 'um centavo' : `${integerToWords(cents)} centavos`;
}

/** Centavos por extenso: 850000 → "oito mil e quinhentos reais". */
export function moneyToWords(totalCents: number): string {
  const reais = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  if (reais === 0 && cents === 0) return 'zero reais';
  if (reais === 0) return centsToWords(cents);
  if (cents === 0) return reaisToWords(reais);
  return `${reaisToWords(reais)} e ${centsToWords(cents)}`;
}

const EXTENSO_SUFFIX_RE = /\s+por\s+extenso\s*\]$/i;

/** "[Valor Total por Extenso]" → "[Valor Total]"; null se não for campo de extenso. */
export function extensoBaseField(placeholder: string): string | null {
  if (!EXTENSO_SUFFIX_RE.test(placeholder)) return null;
  return placeholder.replace(EXTENSO_SUFFIX_RE, ']');
}

/**
 * Extensos que dá para calcular: para cada campo "… por Extenso]" do modelo
 * cujo campo-base tem valor em reais. Devolve só os calculados.
 */
export function computeExtensoFields(
  placeholders: readonly string[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const known = new Map(Object.entries(values));
  const entries = placeholders.flatMap((placeholder) => {
    const base = extensoBaseField(placeholder);
    const cents = base ? parseBrl(known.get(base) ?? '') : null;
    return cents === null ? [] : [[placeholder, moneyToWords(cents)] as const];
  });
  return Object.fromEntries(entries);
}
