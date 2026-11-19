import {
  OPERATORS,
  fetchOperatorRate,
  parseJustTravel,
  parseSuncoast,
  toRate,
} from './exchange-rates.sources';

const SC_HTML = `
  <div class="header-langs-icon">
    <img src="dist/img/pt.svg" alt="Português">
    <div class="text-lang">
        R$ 5.95&emsp; atualizado em 18 nov 2026</div>
  </div>`;

describe('toRate', () => {
  it('aceita ponto ou vírgula como decimal', () => {
    expect(toRate('5.95')).toBe(5.95);
    expect(toRate('6,04')).toBe(6.04);
    expect(toRate(5.8828)).toBe(5.8828);
  });

  it('recusa valor fora de uma faixa plausível de dólar em reais', () => {
    expect(toRate('0')).toBeNull();
    expect(toRate('59.5')).toBeNull();
    expect(toRate('abc')).toBeNull();
    expect(toRate(null)).toBeNull();
  });
});

describe('parseJustTravel', () => {
  it('lê valor e data da API da Just Travel', () => {
    const json = { data: { getCurrencyByShortName: { value: 6.04, updatedAt: '2026-11-18 23:03:40' } } };
    expect(parseJustTravel(json)).toEqual({ value: 6.04, sourceUpdatedLabel: '18/11/2026 23:03' });
  });

  it('falha com mensagem clara quando a resposta muda de formato', () => {
    expect(() => parseJustTravel({ errors: [{ message: 'x' }] })).toThrow('JT: resposta sem câmbio');
  });
});

describe('parseSuncoast', () => {
  it('lê valor e data do cabeçalho da Suncoast', () => {
    expect(parseSuncoast(SC_HTML)).toEqual({ value: 5.95, sourceUpdatedLabel: '18 nov 2026' });
  });

  it('falha quando o cabeçalho não tem o câmbio', () => {
    expect(() => parseSuncoast('<html>manutenção</html>')).toThrow('SC: câmbio não encontrado na página');
  });
});

describe('fetchOperatorRate', () => {
  const jt = OPERATORS.find((o) => o.code === 'JT')!;
  const sc = OPERATORS.find((o) => o.code === 'SC')!;

  it('consulta a API da JT por POST e devolve o câmbio', async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify({ data: { getCurrencyByShortName: { value: 6.04, updatedAt: '2026-11-18 23:03:40' } } })),
    );
    const rate = await fetchOperatorRate(jt, fetchImpl);
    expect(rate.value).toBe(6.04);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('lê a página da SC', async () => {
    const fetchImpl = jest.fn(async () => new Response(SC_HTML));
    expect((await fetchOperatorRate(sc, fetchImpl)).value).toBe(5.95);
  });

  it('traduz HTTP de erro', async () => {
    const fetchImpl = jest.fn(async () => new Response('fora', { status: 503 }));
    await expect(fetchOperatorRate(sc, fetchImpl)).rejects.toThrow('SC: HTTP 503');
  });

  it('a AZ não tem busca automática (só link)', () => {
    const az = OPERATORS.find((o) => o.code === 'AZ')!;
    expect(az.source).toBe('link');
  });
});
