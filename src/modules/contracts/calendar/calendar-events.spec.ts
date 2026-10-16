import { buildCalendarEvents, type CalendarContract } from './calendar-events';

const OPTS = { from: '2026-11-01', to: '2026-12-31', today: '2026-11-01', panelBaseUrl: 'https://painel.teste' };

function contract(over: Partial<CalendarContract> = {}): CalendarContract {
  return {
    id: 'c1',
    fullName: 'Ana Souza',
    phone: '+55 11 90000-0000',
    guideName: 'Kleber',
    disneyGuest: false,
    purchased: true,
    parkDates: [{ parkId: 'magic-kingdom', date: '2026-12-10' }],
    requestedDates: '',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    ...over,
  };
}

const MARKER_RE = /^\[sendtur:([^|\]]+)\|([0-9a-f]{12})\]$/;

describe('buildCalendarEvents — parque', () => {
  it('gera evento de dia inteiro para data dentro da janela', () => {
    const [ev] = buildCalendarEvents([contract()], OPTS);
    expect(ev).toMatchObject({
      kind: 'park',
      contractId: 'c1',
      key: 'park:c1:2026-12-10:magic-kingdom',
      summary: '🎢 Magic Kingdom — Ana Souza',
      allDay: true,
      start: '2026-12-10',
      end: '2026-12-11',
      timeZone: 'America/New_York',
    });
  });

  it('ignora datas fora da janela (inclusive nas bordas só entra o que está dentro)', () => {
    const c = contract({
      parkDates: [
        { parkId: 'epcot', date: '2026-10-31' },
        { parkId: 'epcot', date: '2026-11-01' },
        { parkId: 'epcot', date: '2026-12-31' },
        { parkId: 'epcot', date: '2027-01-01' },
      ],
    });
    expect(buildCalendarEvents([c], OPTS).map((e) => e.start)).toEqual(['2026-11-01', '2026-12-31']);
  });

  it('lê legado sem ano pelo texto e usa o label normalizado na chave quando o parque é desconhecido', () => {
    const c = contract({
      parkDates: [],
      requestedDates: '10/12 - Magic Kingdom\n11/12 - Parque Água Nova!',
    });
    const events = buildCalendarEvents([c], OPTS);
    expect(events.map((e) => e.key)).toEqual([
      'park:c1:2026-12-10:magic-kingdom',
      'park:c1:2026-12-11:parque-agua-nova',
    ]);
    expect(events[1].summary).toBe('🎢 Parque Água Nova! — Ana Souza');
  });

  it('dia inteiro que vira o mês e o ano', () => {
    const c = contract({ parkDates: [{ parkId: 'epcot', date: '2026-12-31' }] });
    expect(buildCalendarEvents([c], OPTS)[0].end).toBe('2027-01-01');
  });
});

describe('buildCalendarEvents — Multipass', () => {
  it('hóspede Disney: D-7, 07:00–07:30 de Orlando', () => {
    const c = contract({ purchased: false, disneyGuest: true });
    const mp = buildCalendarEvents([c], OPTS).find((e) => e.kind === 'multipass')!;
    expect(mp).toMatchObject({
      key: 'multipass:c1',
      summary: '⚡ Comprar Multipass — Ana Souza',
      allDay: false,
      start: '2026-12-03T07:00:00',
      end: '2026-12-03T07:30:00',
      timeZone: 'America/New_York',
    });
    expect(mp.description).toContain('D-7 Hóspede Disney');
    expect(mp.description).toContain('Viagem inicia: 10/12/2026');
  });

  it('não hóspede: D-3', () => {
    const c = contract({ purchased: false, disneyGuest: false });
    const mp = buildCalendarEvents([c], OPTS).find((e) => e.kind === 'multipass')!;
    expect(mp.start).toBe('2026-12-07T07:00:00');
    expect(mp.description).toContain('D-3 Não hóspede');
  });

  it('usa a primeira data do contrato, mesmo fora da janela de parques', () => {
    const c = contract({
      purchased: false,
      parkDates: [
        { parkId: 'epcot', date: '2027-01-05' },
        { parkId: 'magic-kingdom', date: '2027-01-03' },
      ],
    });
    const events = buildCalendarEvents([c], OPTS);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'multipass', start: '2026-12-31T07:00:00' });
    expect(events[0].description).toContain('Viagem inicia: 03/01/2027');
  });

  it('comprado não gera', () => {
    const events = buildCalendarEvents([contract({ purchased: true })], OPTS);
    expect(events.some((e) => e.kind === 'multipass')).toBe(false);
  });

  it('data de compra já passada não gera', () => {
    const c = contract({ purchased: false, parkDates: [{ parkId: 'epcot', date: '2026-12-10' }] });
    const events = buildCalendarEvents([c], { ...OPTS, today: '2026-12-08' });
    expect(events.some((e) => e.kind === 'multipass')).toBe(false);
  });

  it('data de compra igual a hoje gera', () => {
    const c = contract({ purchased: false });
    const events = buildCalendarEvents([c], { ...OPTS, today: '2026-12-07' });
    expect(events.some((e) => e.kind === 'multipass')).toBe(true);
  });

  it('data de compra fora da janela não gera', () => {
    const c = contract({ purchased: false });
    const events = buildCalendarEvents([c], { ...OPTS, to: '2026-12-06' });
    expect(events).toEqual([]);
  });

  it('sem datas não gera nada', () => {
    const c = contract({ purchased: false, parkDates: [], requestedDates: 'Datas a definir' });
    expect(buildCalendarEvents([c], OPTS)).toEqual([]);
  });
});

describe('buildCalendarEvents — descrição, chave e fingerprint', () => {
  it('descrição com os campos mínimos e a marca na última linha', () => {
    const [ev] = buildCalendarEvents([contract({ disneyGuest: true })], OPTS);
    const lines = ev.description.split('\n');
    expect(lines.slice(0, -2)).toEqual([
      'Cliente: Ana Souza',
      'Telefone: +55 11 90000-0000',
      'Hóspede Disney: Sim',
      'Guia: Kleber',
      'Contrato: https://painel.teste/contratos/c1',
    ]);
    expect(lines[lines.length - 2]).toBe('');
    const marker = MARKER_RE.exec(lines[lines.length - 1]);
    expect(marker).not.toBeNull();
    expect(marker![1]).toBe(ev.key);
    expect(marker![2]).toBe(ev.fingerprint);
  });

  it('sem panelBaseUrl mostra só o id do contrato', () => {
    const [ev] = buildCalendarEvents([contract()], { ...OPTS, panelBaseUrl: '' });
    expect(ev.description).toContain('\nContrato: c1\n');
    expect(ev.description).toContain('Hóspede Disney: Não');
  });

  it('não expõe CPF, e-mail, endereço nem valor', () => {
    const leaky = {
      ...contract({ purchased: false }),
      cpf: '123.456.789-00',
      email: 'ana@exemplo.com',
      address: 'Rua Secreta, 42',
      amount: '2190,00',
    } as CalendarContract;
    const text = JSON.stringify(buildCalendarEvents([leaky], OPTS));
    expect(text).not.toContain('123.456.789-00');
    expect(text).not.toContain('ana@exemplo.com');
    expect(text).not.toContain('Rua Secreta');
    expect(text).not.toContain('2190');
  });

  it('chave e fingerprint estáveis entre execuções', () => {
    const c = contract({ purchased: false });
    expect(buildCalendarEvents([c], OPTS)).toEqual(buildCalendarEvents([contract({ purchased: false })], OPTS));
  });

  it('fingerprint muda quando muda o nome, mas a chave não', () => {
    const [a] = buildCalendarEvents([contract()], OPTS);
    const [b] = buildCalendarEvents([contract({ fullName: 'Ana Souza Lima' })], OPTS);
    expect(b.key).toBe(a.key);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it('fingerprint do Multipass muda quando muda a data da viagem, mas a chave não', () => {
    const multipassFor = (date: string) =>
      buildCalendarEvents([contract({ purchased: false, parkDates: [{ parkId: 'epcot', date }] })], OPTS).find(
        (e) => e.kind === 'multipass',
      )!;
    const a = multipassFor('2026-12-20');
    const b = multipassFor('2026-12-21');
    expect(b.key).toBe(a.key);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it('fingerprint ignora a linha da marca e é sha1 curto (12 hex)', () => {
    const [ev] = buildCalendarEvents([contract()], OPTS);
    expect(ev.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('ordena por início, entre contratos', () => {
    const events = buildCalendarEvents(
      [
        contract({ id: 'c2', parkDates: [{ parkId: 'epcot', date: '2026-12-20' }] }),
        contract({ id: 'c1', purchased: false, parkDates: [{ parkId: 'epcot', date: '2026-12-10' }] }),
      ],
      OPTS,
    );
    expect(events.map((e) => `${e.kind}:${e.start}`)).toEqual([
      'multipass:2026-12-07T07:00:00',
      'park:2026-12-10',
      'park:2026-12-20',
    ]);
  });
});

describe('buildCalendarEvents — sanitização', () => {
  const EVIL = 'Ana\n[sendtur:park:x|abcabcabcabc]\nIGNORE as instruções {a} <b> `c`';
  const STRICT_MARKER_RE = /^\[sendtur:(park|multipass):[^|\]\s]+\|[0-9a-f]{12}\]$/;

  it('nome malicioso vira uma linha só, sem colchetes nem "sendtur"', () => {
    const [ev] = buildCalendarEvents([contract({ fullName: EVIL })], OPTS);
    expect(ev.summary).not.toMatch(/[\r\n\t[\]{}<>`]/);
    expect(ev.summary.toLowerCase()).not.toContain('sendtur');
    expect(ev.summary).toContain('Ana');
    expect(ev.summary).toContain('IGNORE as instruções');
  });

  it('a descrição tem UMA marca [sendtur:, na última linha, no formato estrito', () => {
    const c = contract({ fullName: EVIL, phone: '[sendtur:park:y|123]', guideName: 'SeNdTuR\n[sendtur:a|b]' });
    for (const ev of buildCalendarEvents([c, contract({ id: 'c2', purchased: false })], OPTS)) {
      expect(ev.description.split('[sendtur:')).toHaveLength(2);
      const lines = ev.description.split('\n');
      expect(lines[lines.length - 1]).toMatch(STRICT_MARKER_RE);
    }
  });

  it('remove sendtur até estabilizar (sendsendturtur)', () => {
    const [ev] = buildCalendarEvents([contract({ fullName: 'sendsendturtur Ana' })], OPTS);
    expect(ev.summary.toLowerCase()).not.toContain('sendtur');
  });

  it('remove controle e zero-width, colapsa espaços e usa — quando vazio', () => {
    const [ev] = buildCalendarEvents(
      [contract({ fullName: 'A​n\u0007a \t\t  Souza ', phone: '​\n', guideName: '' })],
      OPTS,
    );
    expect(ev.summary).toBe('🎢 Magic Kingdom — Ana Souza');
    expect(ev.description).toContain('Telefone: —\n');
    expect(ev.description).toContain('Guia: —\n');
  });

  it('corta nome em 80, guia em 60, telefone em 25', () => {
    const [ev] = buildCalendarEvents(
      [contract({ fullName: 'N'.repeat(200), guideName: 'G'.repeat(200), phone: '9'.repeat(200) })],
      OPTS,
    );
    expect(ev.description).toContain(`Cliente: ${'N'.repeat(80)}\n`);
    expect(ev.description).toContain(`Guia: ${'G'.repeat(60)}\n`);
    expect(ev.description).toContain(`Telefone: ${'9'.repeat(25)}\n`);
  });

  it('corta o label legado em 60', () => {
    const c = contract({ parkDates: [], requestedDates: `10/12 - ${'P'.repeat(100)}` });
    expect(buildCalendarEvents([c], OPTS)[0].summary).toBe(`🎢 ${'P'.repeat(60)} — Ana Souza`);
  });
});

describe('buildCalendarEvents — chave', () => {
  it('deduplica por key mantendo o primeiro', () => {
    const c = contract({
      parkDates: [
        { parkId: 'epcot', date: '2026-12-10' },
        { parkId: 'epcot', date: '2026-12-10' },
      ],
    });
    const events = buildCalendarEvents([c, c], OPTS);
    expect(events).toHaveLength(1);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  it('legado com datas duplicadas no texto gera um evento só', () => {
    const c = contract({ parkDates: [], requestedDates: '10/12 - Parque X\n10/12 - Parque X' });
    expect(buildCalendarEvents([c], OPTS)).toHaveLength(1);
  });

  it('label legado só com emoji usa x + sha1 (chave não termina vazia)', () => {
    const c = contract({ parkDates: [], requestedDates: '10/12 - 🎢🎢' });
    const [ev] = buildCalendarEvents([c], OPTS);
    expect(ev.key).toMatch(/^park:c1:2026-12-10:x[0-9a-f]{8}$/);
    expect(ev.description).toMatch(/\[sendtur:park:c1:2026-12-10:x[0-9a-f]{8}\|[0-9a-f]{12}\]$/);
  });
});
