import { Prisma } from '@prisma/client';
import { ExchangeRatesService, STALE_AFTER_MS, isEnabledFor } from './exchange-rates.service';

const NOW = new Date('2026-11-19T15:00:00Z');

function makePrisma(rows: Record<string, any> = {}, settings: unknown = { operatorExchangeRates: true }) {
  return {
    operatorExchangeRate: {
      findUnique: jest.fn(async ({ where }) => rows[where.code] ?? null),
      findMany: jest.fn(async () => Object.values(rows)),
      upsert: jest.fn(async (args) => args),
      update: jest.fn(async (args) => args),
    },
    organization: { findUnique: jest.fn(async () => ({ settings })) },
  };
}

const okFetch = (byUrl: Record<string, string>) =>
  jest.fn(async (url: string) => new Response(byUrl[url] ?? 'nada', { status: byUrl[url] ? 200 : 404 }));

const JT_BODY = JSON.stringify({ data: { getCurrencyByShortName: { value: 6.04, updatedAt: '2026-11-18 23:03:40' } } });
const SC_BODY = '<div>R$ 5.95&emsp; atualizado em 18 nov 2026</div>';
const URLS = {
  'https://hermes.justtraveltour.com/api': JT_BODY,
  'https://orlandofastpass.suncoastusa.com.br/': SC_BODY,
};

describe('isEnabledFor', () => {
  it('só liga com operatorExchangeRates === true', () => {
    expect(isEnabledFor({ operatorExchangeRates: true })).toBe(true);
    expect(isEnabledFor({ operatorExchangeRates: 'sim' })).toBe(false);
    expect(isEnabledFor(null)).toBe(false);
  });
});

describe('ExchangeRatesService.refreshAll', () => {
  it('grava JT e SC e não busca a AZ', async () => {
    const prisma = makePrisma();
    const svc = new ExchangeRatesService(prisma as never).useFetch(okFetch(URLS));
    const result = await svc.refreshAll(NOW);
    expect(result).toEqual({ updated: ['JT', 'SC'], changed: ['JT', 'SC'], failed: [] });
    const codes = prisma.operatorExchangeRate.upsert.mock.calls.map((c: any[]) => c[0].where.code);
    expect(codes).toEqual(['JT', 'SC']);
  });

  it('mantém changedAt quando o valor não mudou', async () => {
    const before = new Date('2026-11-18T10:00:00Z');
    const prisma = makePrisma({ JT: { code: 'JT', value: new Prisma.Decimal('6.04'), changedAt: before } });
    const svc = new ExchangeRatesService(prisma as never).useFetch(okFetch(URLS));
    const result = await svc.refreshAll(NOW);
    expect(result.changed).toEqual(['SC']);
    const jtCall = prisma.operatorExchangeRate.upsert.mock.calls.find((c: any[]) => c[0].where.code === 'JT')![0];
    expect(jtCall.update.changedAt).toBe(before);
    expect(jtCall.update.fetchedAt).toBe(NOW);
  });

  it('falha de uma operadora não derruba a outra e fica registrada', async () => {
    const prisma = makePrisma({ SC: { code: 'SC', value: new Prisma.Decimal('5.9'), changedAt: NOW } });
    const svc = new ExchangeRatesService(prisma as never).useFetch(
      okFetch({ 'https://hermes.justtraveltour.com/api': JT_BODY }),
    );
    const result = await svc.refreshAll(NOW);
    expect(result.updated).toEqual(['JT']);
    expect(result.failed).toEqual([{ code: 'SC', error: 'SC: HTTP 404' }]);
    expect(prisma.operatorExchangeRate.update).toHaveBeenCalledWith({
      where: { code: 'SC' },
      data: { lastError: 'SC: HTTP 404', lastErrorAt: NOW },
    });
  });
});

describe('ExchangeRatesService.listFor', () => {
  it('org sem o recurso recebe enabled=false e lista vazia', async () => {
    const prisma = makePrisma({}, {});
    const svc = new ExchangeRatesService(prisma as never);
    expect(await svc.listFor('org1', NOW)).toEqual({ enabled: false, rates: [] });
  });

  it('lista as três siglas, AZ só como link, e marca leitura antiga', async () => {
    const old = new Date(NOW.getTime() - STALE_AFTER_MS - 1);
    const prisma = makePrisma({
      JT: { code: 'JT', value: new Prisma.Decimal('6.04'), sourceUpdatedLabel: '18/11/2026 23:03', fetchedAt: NOW, changedAt: NOW },
      SC: { code: 'SC', value: new Prisma.Decimal('5.95'), sourceUpdatedLabel: '18 nov 2026', fetchedAt: old, changedAt: old },
    });
    const svc = new ExchangeRatesService(prisma as never);
    const out = await svc.listFor('org1', NOW);
    expect(out.enabled).toBe(true);
    expect(out.rates.map((r) => [r.code, r.value, r.stale, r.manual])).toEqual([
      ['JT', 6.04, false, false],
      ['SC', 5.95, true, false],
      ['AZ', null, false, true],
    ]);
    expect(out.rates[2].url).toBe('https://www.azulviagens.com.br/');
  });
});
