import {
  normalizeFailureReason,
  summarizeFailures,
} from './failure-reason.util';

describe('normalizeFailureReason', () => {
  it.each([
    ['[131047] Re-engagement message: Message failed to send because more than 24 hours have passed'],
    ['Re-engagement message'],
    ['Janela de atendimento (24h/72h) fechada — envie um template aprovado.'],
    ['Janela de atendimento fechada — envie um template aprovado.'],
  ])('janela fechada: %s', (raw) => {
    expect(normalizeFailureReason(raw)).toBe('Janela de 24h fechada');
  });

  it.each([
    ['[131026] Message undeliverable'],
    ['Message Undeliverable.'],
  ])('número que não recebe: %s', (raw) => {
    expect(normalizeFailureReason(raw)).toBe('Número não recebe mensagens');
  });

  it.each([
    ['[131049] This message was not delivered to maintain healthy ecosystem engagement.'],
    ['not delivered to maintain a Healthy Ecosystem'],
  ])('limite de marketing: %s', (raw) => {
    expect(normalizeFailureReason(raw)).toBe('Limite de marketing da Meta');
  });

  it.each([[null], [undefined], [''], ['   ']])('vazio: %p', (raw) => {
    expect(normalizeFailureReason(raw)).toBe('Sem motivo informado');
  });

  it('qualquer outro texto vira os primeiros 60 caracteres', () => {
    const raw = `[131000] Something went wrong: ${'x'.repeat(200)}`;
    const out = normalizeFailureReason(raw);
    expect(out).toHaveLength(60);
    expect(raw.startsWith(out)).toBe(true);
  });

  it('colapsa quebras de linha e espaços antes de cortar', () => {
    expect(normalizeFailureReason('  Request failed\n  with status code 400 ')).toBe(
      'Request failed with status code 400',
    );
  });
});

describe('summarizeFailures', () => {
  it('soma textos diferentes que caem no mesmo motivo e ordena por contagem', () => {
    const out = summarizeFailures([
      { reason: '[131026] Message undeliverable', count: 3 },
      { reason: '[131047] Re-engagement message', count: 5 },
      { reason: 'Janela de atendimento fechada — envie um template aprovado.', count: 4 },
      { reason: null, count: 1 },
    ]);
    expect(out).toEqual([
      { reason: 'Janela de 24h fechada', count: 9 },
      { reason: 'Número não recebe mensagens', count: 3 },
      { reason: 'Sem motivo informado', count: 1 },
    ]);
  });

  it('devolve no máximo 8 motivos', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      reason: `erro ${i}`,
      count: 12 - i,
    }));
    const out = summarizeFailures(rows);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({ reason: 'erro 0', count: 12 });
  });

  it('empate é desfeito pelo nome, para a ordem ser estável', () => {
    const out = summarizeFailures([
      { reason: 'b', count: 2 },
      { reason: 'a', count: 2 },
    ]);
    expect(out.map((r) => r.reason)).toEqual(['a', 'b']);
  });
});
