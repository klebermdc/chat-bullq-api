import { multipassBuyDate, multipassReminders } from './multipass';

describe('multipassBuyDate', () => {
  it('hóspede Disney: 7 dias antes da primeira data', () => {
    expect(multipassBuyDate('2026-12-10', true)).toBe('2026-12-03');
  });
  it('não hóspede: 3 dias antes', () => {
    expect(multipassBuyDate('2026-12-10', false)).toBe('2026-12-07');
  });
});

describe('multipassReminders', () => {
  const today = '2026-12-01';
  const base = { purchased: false, disneyGuest: false, guideName: 'Kleber', fullName: 'A', phone: '1' };

  it('inclui quem compra dentro de 14 dias e ainda vai viajar, ordenado por data de compra', () => {
    const out = multipassReminders(
      [
        { ...base, id: 'b', dates: ['2026-12-12'] }, // compra 12-09
        { ...base, id: 'a', dates: ['2026-12-05'] }, // compra 12-02
        { ...base, id: 'c', dates: ['2027-02-01'] }, // fora da janela
        { ...base, id: 'd', dates: ['2026-12-05'], purchased: true },
        { ...base, id: 'e', dates: ['2026-11-30'] }, // já viajou
      ],
      today,
    );
    expect(out.map((r) => [r.id, r.buyDate, r.daysUntilBuy])).toEqual([
      ['a', '2026-12-02', 1],
      ['b', '2026-12-09', 8],
    ]);
  });

  it('compra atrasada tem daysUntilBuy negativo', () => {
    const out = multipassReminders([{ ...base, id: 'x', dates: ['2026-12-03'] }], today);
    expect(out[0].daysUntilBuy).toBe(-1);
  });
});
