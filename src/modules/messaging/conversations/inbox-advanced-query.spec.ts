import { parseAdvancedQuery, parseAssignees } from './inbox-advanced-query';

describe('parseAssignees (?assignedToId=)', () => {
  it('vazio não filtra', () => {
    expect(parseAssignees(undefined)).toEqual({});
    expect(parseAssignees('')).toEqual({});
  });

  it('um id só mantém o formato antigo', () => {
    expect(parseAssignees('u1')).toEqual({ assignedToId: 'u1' });
  });

  it('"none" sozinho vira sem atendente', () => {
    expect(parseAssignees('none')).toEqual({ assignedToNone: true });
  });

  it('lista com "none" vira lista + sem atendente', () => {
    expect(parseAssignees('u1, none ,u2')).toEqual({
      assignedToIds: ['u1', 'u2'],
      assignedToNone: true,
    });
  });

  it('dois ids viram lista', () => {
    expect(parseAssignees('u1,u2')).toEqual({ assignedToIds: ['u1', 'u2'] });
  });
});

describe('parseAdvancedQuery', () => {
  const now = new Date('2026-11-07T12:00:00Z');

  it('sem nada na URL não liga filtro nenhum', () => {
    expect(parseAdvancedQuery({}, now)).toEqual({});
  });

  it('lê listas separadas por vírgula e descarta vazios', () => {
    const out = parseAdvancedQuery(
      { channelIds: 'c1,,c2', stageIds: 's1', excludeTagIds: ' x ' },
      now,
    );

    expect(out.channelIds).toEqual(['c1', 'c2']);
    expect(out.stageIds).toEqual(['s1']);
    expect(out.excludeTagIds).toEqual(['x']);
  });

  it('aceita só valores conhecidos nos enums', () => {
    const out = parseAdvancedQuery(
      { tagMode: 'all', lost: 'only', origin: 'ad', dateField: 'created' },
      now,
    );
    expect(out).toMatchObject({
      tagMatch: 'all',
      lost: 'only',
      origin: 'ad',
      dateField: 'created',
    });

    const junk = parseAdvancedQuery(
      { tagMode: 'x', lost: 'x', origin: 'x', dateField: 'x' },
      now,
    );
    expect(junk).toEqual({});
  });

  it('motivo de venda perdida desconhecido é descartado', () => {
    const out = parseAdvancedQuery({ lostReasons: 'PRICE,HACK' }, now);

    expect(out.lostReasons).toEqual(['PRICE']);
  });

  it('idleHours vira o instante de corte', () => {
    const out = parseAdvancedQuery({ idleHours: '4' }, now);

    expect(out.idleBefore).toEqual(new Date('2026-11-07T08:00:00Z'));
  });

  it('idleHours fora da faixa ou não numérico é ignorado', () => {
    expect(parseAdvancedQuery({ idleHours: '0' }, now).idleBefore).toBeUndefined();
    expect(parseAdvancedQuery({ idleHours: 'abc' }, now).idleBefore).toBeUndefined();
    expect(
      parseAdvancedQuery({ idleHours: '999999' }, now).idleBefore,
    ).toBeUndefined();
  });

  it('lista com mais de 100 itens é cortada', () => {
    const many = Array.from({ length: 150 }, (_, i) => `c${i}`).join(',');

    expect(parseAdvancedQuery({ channelIds: many }, now).channelIds).toHaveLength(100);
  });
});
