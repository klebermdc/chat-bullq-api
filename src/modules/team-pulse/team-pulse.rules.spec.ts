import { decidePulse, localHour, withinHoursMembers } from './team-pulse.rules';

const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const TZ = 'America/Sao_Paulo';

describe('localHour', () => {
  it('devolve a hora cheia no fuso da org', () => {
    expect(localHour(sp('2026-11-19T15:00:04'), TZ)).toBe(15);
    expect(localHour(sp('2026-11-19T00:10:00'), TZ)).toBe(0);
  });
});

describe('decidePulse', () => {
  const base = { closingHour: 22, anyoneWithinHours: true };

  it('manda o fechamento na hora do fechamento, mesmo sem ninguém no horário', () => {
    expect(decidePulse({ ...base, hour: 22, anyoneWithinHours: false })).toBe('closing');
  });

  it('manda o pulso antes do fechamento quando alguém está no horário', () => {
    expect(decidePulse({ ...base, hour: 15 })).toBe('hourly');
  });

  it('não manda o pulso quando ninguém está no horário (ex.: domingo sem plantão)', () => {
    expect(decidePulse({ ...base, hour: 15, anyoneWithinHours: false })).toBeNull();
  });

  it('não manda nada depois do fechamento', () => {
    expect(decidePulse({ ...base, hour: 23 })).toBeNull();
  });
});

describe('withinHoursMembers', () => {
  it('fica só com quem está dentro do próprio horário agora', () => {
    // Arrange
    const rows = [
      { name: 'Pedro', schedule: { withinHours: true } },
      { name: 'Bárbara', schedule: { withinHours: false } },
      { name: 'Kleber', schedule: { withinHours: null } },
    ];
    // Act
    const result = withinHoursMembers(rows);
    // Assert
    expect(result.map((r) => r.name)).toEqual(['Pedro']);
  });
});
