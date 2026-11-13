import { reminderJobId, reminderPlan, reminderText, shouldDeliver } from './agenda.reminders';

const sp = (iso: string) => new Date(`${iso}-03:00`);

describe('reminderPlan', () => {
  it('lembra 10 min antes e na hora', () => {
    const plan = reminderPlan(sp('2026-11-16T15:00:00'), sp('2026-11-16T09:00:00'));
    expect(plan).toEqual([
      { stage: 'antes', at: sp('2026-11-16T14:50:00') },
      { stage: 'agora', at: sp('2026-11-16T15:00:00') },
    ]);
  });

  it('não agenda lembrete que já passou (marcado em cima da hora)', () => {
    expect(reminderPlan(sp('2026-11-16T15:00:00'), sp('2026-11-16T14:55:00'))).toEqual([
      { stage: 'agora', at: sp('2026-11-16T15:00:00') },
    ]);
  });
});

describe('reminderJobId', () => {
  it('muda quando o horário muda (remarcar cria lembretes novos)', () => {
    const a = reminderJobId('ap1', 'antes', sp('2026-11-16T15:00:00'));
    const b = reminderJobId('ap1', 'antes', sp('2026-11-16T16:00:00'));
    expect(a).not.toBe(b);
    expect(a).not.toContain(':'); // BullMQ não aceita ":" no jobId
  });
});

describe('shouldDeliver', () => {
  const startsAt = sp('2026-11-16T15:00:00');
  it('entrega só se continua marcado e no mesmo horário', () => {
    expect(shouldDeliver(startsAt.getTime(), { status: 'MARCADO', startsAt })).toBe(true);
    expect(shouldDeliver(startsAt.getTime(), { status: 'CANCELADO', startsAt })).toBe(false);
    expect(shouldDeliver(startsAt.getTime(), { status: 'MARCADO', startsAt: sp('2026-11-16T16:00:00') })).toBe(false);
    expect(shouldDeliver(startsAt.getTime(), null)).toBe(false);
  });
});

describe('reminderText', () => {
  it('monta título e texto com o nome do cliente e o horário local', () => {
    const t = reminderText('antes', { contactName: 'Kleber', startsAt: sp('2026-11-16T15:00:00'), tz: 'America/Sao_Paulo' });
    expect(t.title).toBe('Retorno em 10 min: Kleber');
    expect(t.body).toBe('Ligar para Kleber às 15:00.');
    const agora = reminderText('agora', { contactName: null, startsAt: sp('2026-11-16T15:00:00'), tz: 'America/Sao_Paulo' });
    expect(agora.title).toBe('Hora do retorno: cliente');
  });
});
