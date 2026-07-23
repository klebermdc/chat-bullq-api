import { stripThinkBlocks, stripForeignScripts } from './text-guards';

describe('stripForeignScripts', () => {
  it('remove caracteres chineses vazados e limpa o espaço', () => {
    expect(stripForeignScripts('quantas pessoas vão? 成人 e crianças')).toBe(
      'quantas pessoas vão? e crianças',
    );
  });
  it('preserva português com acento e emoji', () => {
    expect(stripForeignScripts('não é você, tá? 💙😊')).toBe('não é você, tá? 💙😊');
  });
  it('remove japonês/coreano também', () => {
    expect(stripForeignScripts('olá こんにちは 안녕 mundo')).toBe('olá mundo');
  });
});

/**
 * Modelos de raciocínio (ex.: MiniMax M-series) emitem <think>...</think> antes
 * da resposta. Isso NUNCA pode vazar pro cliente.
 */
describe('stripThinkBlocks', () => {
  it('remove um bloco <think>...</think> completo e mantém a resposta', () => {
    const raw = '<think>o cliente quer Disney, vou acolher</think>\n\nOi! Que alegria 😊';
    expect(stripThinkBlocks(raw)).toBe('Oi! Que alegria 😊');
  });

  it('remove múltiplos blocos', () => {
    expect(stripThinkBlocks('<think>a</think>Olá<think>b</think> tudo bem?')).toBe(
      'Olá tudo bem?',
    );
  });

  it('é case-insensitive e multiline', () => {
    const raw = '<THINK>\nlinha1\nlinha2\n</THINK>resposta';
    expect(stripThinkBlocks(raw)).toBe('resposta');
  });

  it('bloco não fechado (só <think> aberto): descarta tudo dali pra frente', () => {
    expect(stripThinkBlocks('resposta boa <think>raciocínio sem fim')).toBe(
      'resposta boa',
    );
  });

  it('tag de fechamento solta: mantém só o que vem depois', () => {
    expect(stripThinkBlocks('raciocínio perdido</think>a resposta real')).toBe(
      'a resposta real',
    );
  });

  it('texto sem think passa intacto (trim)', () => {
    expect(stripThinkBlocks('  só a resposta  ')).toBe('só a resposta');
  });
});
