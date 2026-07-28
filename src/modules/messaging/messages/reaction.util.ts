/**
 * Um emoji, com modificador de tom de pele e/ou seletor de variação.
 * Ex.: 👍 · 👍🏽 · ❤️
 */
const EMOJI_PART = '\\p{Extended_Pictographic}(?:\\p{Emoji_Modifier}|\\uFE0F)?';

/**
 * Um emoji só, na definição que o usuário enxerga:
 *  - uma bandeira (dois indicadores regionais), ou
 *  - um pictográfico, opcionalmente emendado por ZWJ (👩‍💻, 👨‍👩‍👧).
 *
 * Contar `.length` não funcionaria: "👍" tem length 2 (par surrogate) e
 * "👩‍💻" tem 5. `Intl.Segmenter` resolveria, mas os tipos do TS deste projeto
 * não o expõem, e mexer no `lib` do tsconfig por causa de uma função afetaria
 * a compilação inteira.
 */
const SINGLE_EMOJI = new RegExp(
  `^(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|${EMOJI_PART}(?:\\u200D${EMOJI_PART})*)$`,
  'u',
);

/** Reação tem que ser exatamente UM emoji — nem texto, nem dois. */
export function isSingleEmoji(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  return SINGLE_EMOJI.test(value);
}
