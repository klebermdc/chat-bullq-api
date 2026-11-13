import { buildVisitLines } from './visit-transcript';
import type { VisitMessage } from './mystery-shopper.types';

const base: VisitMessage = {
  id: 'm1',
  direction: 'INBOUND',
  senderId: null,
  isAutomated: false,
  text: 'Oi,\nquero Orlando',
  createdAt: new Date('2026-11-13T10:00:00Z'),
};

describe('buildVisitLines', () => {
  test('papéis: cliente, vendedor e automática (Aline/robô)', () => {
    const lines = buildVisitLines([
      base,
      { ...base, id: 'm2', direction: 'OUTBOUND', text: 'Sou a Aline' },
      { ...base, id: 'm3', direction: 'OUTBOUND', senderId: 'u1', text: 'Oi! Sou o Pedro' },
      { ...base, id: 'm4', direction: 'OUTBOUND', senderId: 'u1', isAutomated: true, text: 'Lembrete' },
    ], null);
    expect(lines.map((l) => l.role)).toEqual(['CLIENTE', 'AUTOMATICA', 'VENDEDOR', 'AUTOMATICA']);
  });

  test('outro membro da equipe vira EQUIPE quando o vendedor é conhecido', () => {
    const lines = buildVisitLines(
      [
        { ...base, id: 'm1', direction: 'OUTBOUND', senderId: 'u1', text: 'Oi, sou o Pedro' },
        { ...base, id: 'm2', direction: 'OUTBOUND', senderId: 'colega', text: 'Posso ajudar?' },
        { ...base, id: 'm3', direction: 'OUTBOUND', senderId: 'colega', isAutomated: true, text: 'Lembrete' },
      ],
      'u1',
    );
    expect(lines.map((l) => l.role)).toEqual(['VENDEDOR', 'EQUIPE', 'AUTOMATICA']);
  });

  test('quebra de linha vira espaço e mídia sem texto ganha marcador', () => {
    const lines = buildVisitLines([base, { ...base, id: 'm2', text: '' }], null);
    expect(lines[0].text).toBe('Oi, quero Orlando');
    expect(lines[1].text).toBe('[mídia sem texto]');
  });
});
