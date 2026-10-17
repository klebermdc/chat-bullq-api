import {
  advanceCursor,
  BackfillChannel,
  cursorWhere,
  resolveBackfillChannel,
  START_CURSOR,
} from './billing-backfill.util';

const at = (iso: string) => new Date(iso);
const ev = (id: string, iso: string) => ({ id, receivedAt: at(iso) });

describe('cursorWhere', () => {
  it('sem cursor e sem since: não filtra nada', () => {
    expect(cursorWhere(START_CURSOR, null)).toEqual({});
  });

  it('sem cursor: começa no since', () => {
    const since = at('2026-09-01T03:00:00Z');
    expect(cursorWhere(START_CURSOR, since)).toEqual({ receivedAt: { gte: since } });
  });

  it('com cursor: retoma no mesmo instante pulando os ids já lidos', () => {
    const cursor = { receivedAt: at('2026-09-02T10:00:00Z'), seenIds: ['a', 'b'] };
    expect(cursorWhere(cursor, at('2026-09-01T03:00:00Z'))).toEqual({
      receivedAt: { gte: cursor.receivedAt },
      id: { notIn: ['a', 'b'] },
    });
  });
});

describe('advanceCursor', () => {
  it('lote vazio mantém o cursor', () => {
    expect(advanceCursor(START_CURSOR, [])).toBe(START_CURSOR);
  });

  it('aponta para o último instante do lote e guarda só os ids desse instante', () => {
    const next = advanceCursor(START_CURSOR, [
      ev('a', '2026-09-02T10:00:00.000Z'),
      ev('b', '2026-09-02T10:00:01.000Z'),
      ev('c', '2026-09-02T10:00:01.000Z'),
    ]);
    expect(next).toEqual({
      receivedAt: at('2026-09-02T10:00:01.000Z'),
      seenIds: ['b', 'c'],
    });
  });

  it('acumula os ids quando o lote inteiro cai no mesmo instante do cursor', () => {
    const cursor = { receivedAt: at('2026-09-02T10:00:01.000Z'), seenIds: ['b', 'c'] };
    const next = advanceCursor(cursor, [ev('d', '2026-09-02T10:00:01.000Z')]);
    expect(next.seenIds).toEqual(['b', 'c', 'd']);
    expect(cursor.seenIds).toEqual(['b', 'c']); // não muta o cursor anterior
  });

  it('paginar com o cursor não perde nem repete evento com timestamp empatado', () => {
    const all = [
      ev('a', '2026-09-02T10:00:00.000Z'),
      ev('b', '2026-09-02T10:00:01.000Z'),
      ev('c', '2026-09-02T10:00:01.000Z'),
      ev('d', '2026-09-02T10:00:01.000Z'),
      ev('e', '2026-09-02T10:00:02.000Z'),
    ];
    const pageSize = 2;
    const read: string[] = [];
    let cursor = START_CURSOR;
    for (;;) {
      const where = cursorWhere(cursor, null);
      const page = all
        .filter((e) => !where.receivedAt || e.receivedAt >= where.receivedAt.gte)
        .filter((e) => !where.id || !where.id.notIn.includes(e.id))
        .slice(0, pageSize);
      if (page.length === 0) break;
      read.push(...page.map((e) => e.id));
      cursor = advanceCursor(cursor, page);
    }
    expect(read).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('resolveBackfillChannel', () => {
  const chanA: BackfillChannel = { id: 'chanA', organizationId: 'org1', phoneNumberId: 'PN_A' };
  const chanB: BackfillChannel = { id: 'chanB', organizationId: 'org2', phoneNumberId: 'PN_B' };
  const byPhone = new Map([
    ['PN_A', [chanA]],
    ['PN_B', [chanB]],
    ['PN_DUP', [chanA, chanB]],
  ]);

  it('evento roteado: usa o canal do evento', () => {
    expect(resolveBackfillChannel(chanA, 'PN_A', byPhone)).toBe(chanA);
  });

  it('evento roteado sem phone_number_id no payload: confia no canal do evento', () => {
    expect(resolveBackfillChannel(chanA, null, byPhone)).toBe(chanA);
  });

  it('evento roteado, mas o status é de OUTRO número da mesma WABA: descarta', () => {
    // Mesmo escopo por número do parseWebhook: o lote é gravado uma vez por
    // canal; o status do número B entra pelo evento do canal B, não do A.
    expect(resolveBackfillChannel(chanA, 'PN_B', byPhone)).toBeNull();
  });

  it('canal sem phoneNumberId na config não filtra por número', () => {
    const legacy = { ...chanA, phoneNumberId: null };
    expect(resolveBackfillChannel(legacy, 'PN_B', byPhone)).toBe(legacy);
  });

  it('evento sem canal: resolve pelo phone_number_id', () => {
    expect(resolveBackfillChannel(null, 'PN_B', byPhone)).toBe(chanB);
  });

  it('evento sem canal e número desconhecido, ausente ou ambíguo: descarta', () => {
    expect(resolveBackfillChannel(null, 'PN_X', byPhone)).toBeNull();
    expect(resolveBackfillChannel(null, null, byPhone)).toBeNull();
    expect(resolveBackfillChannel(null, 'PN_DUP', byPhone)).toBeNull();
  });
});
