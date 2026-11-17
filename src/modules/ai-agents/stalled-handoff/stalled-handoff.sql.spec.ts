import { STALL_HOURS, STALL_MIN_INBOUND, buildStalledHandoffQuery } from './stalled-handoff.sql';

describe('vigia de lead parado com a IA', () => {
  it('manda para a fila depois de 2h de silêncio do cliente', () => {
    expect(STALL_HOURS).toBe(2);
  });

  it('basta o cliente ter escrito uma vez, mesmo parando numa pergunta base', () => {
    expect(STALL_MIN_INBOUND).toBe(1);
  });

  it('a consulta usa os dois limites', () => {
    const sql = buildStalledHandoffQuery();

    expect(sql.values).toEqual(expect.arrayContaining([2, 1]));
  });
});
