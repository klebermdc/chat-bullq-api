import { describe, expect, test } from 'vitest';
import { SpeechFilter, cleanForSpeech, filterSpeechStream } from './speech-filter.js';

const run = (chunks: string[]) => {
  const f = new SpeechFilter();
  return chunks.map((c) => f.push(c)).join('') + f.flush();
};

describe('SpeechFilter', () => {
  test('remove bloco <think> inteiro num pedaço só', () => {
    expect(run(['<think>raciocínio em inglês</think>Olá, tudo bem?'])).toBe('Olá, tudo bem?');
  });

  test('remove <think> que abre e fecha em pedaços diferentes', () => {
    expect(run(['Oi! <th', 'ink>pensando...', ' mais </thi', 'nk> Posso ajudar?'])).toBe('Oi!  Posso ajudar?');
  });

  test('nunca fala o conteúdo de um <think> que não fechou', () => {
    expect(run(['Certo. <think>The user wants'])).toBe('Certo. ');
  });

  test('não engole texto normal que só parece começo de tag', () => {
    expect(run(['Preço < 100', ' reais'])).toBe('Preço < 100 reais');
  });
});

describe('cleanForSpeech', () => {
  test('tira markdown, listas, emojis e links', () => {
    const text = '**Ótimo!** 😄\n- Magic Kingdom\n2. Epcot\nveja https://ofp.com.br/x';
    expect(cleanForSpeech(text)).toBe('Ótimo! \nMagic Kingdom\nEpcot\nveja ');
  });
});

describe('filterSpeechStream', () => {
  test('filtra um stream de pedaços', async () => {
    async function* source() {
      yield '<think>x</think>';
      yield 'Bom dia!';
    }
    const out: string[] = [];
    for await (const c of filterSpeechStream(source()) as unknown as AsyncIterable<string>) out.push(c);
    expect(out.join('')).toBe('Bom dia!');
  });
});
