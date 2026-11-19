import { Prisma } from '@prisma/client';
import { ExchangeRatesService, MANUAL_STALE_AFTER_MS, STALE_AFTER_MS, isEnabledFor, readManualRate } from './exchange-rates.service';

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
    user: { findUnique: jest.fn(async () => ({ name: 'Kleber' })) },
    $executeRaw: jest.fn(async () => 1),
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

describe('lançamento manual (AZ)', () => {
  const az = (updatedAt: string) => ({
    operatorExchangeRates: true,
    manualExchangeRates: { AZ: { value: 5.88, updatedAt, updatedByName: 'Kleber' } },
  });

  it('readManualRate ignora lixo', () => {
    expect(readManualRate({ manualExchangeRates: { AZ: { value: 'x', updatedAt: 'y' } } }, 'AZ')).toBeNull();
    expect(readManualRate(null, 'AZ')).toBeNull();
  });

  it('lista o valor lançado com quem lançou', async () => {
    const svc = new ExchangeRatesService(makePrisma({}, az(NOW.toISOString())) as never);
    const azView = (await svc.listFor('org1', NOW)).rates.find((r) => r.code === 'AZ')!;
    expect([azView.value, azView.updatedByName, azView.stale, azView.manual]).toEqual([5.88, 'Kleber', false, true]);
  });

  it('lançamento com mais de 24h aparece apagado', async () => {
    const old = new Date(NOW.getTime() - MANUAL_STALE_AFTER_MS - 1).toISOString();
    const svc = new ExchangeRatesService(makePrisma({}, az(old)) as never);
    expect((await svc.listFor('org1', NOW)).rates.find((r) => r.code === 'AZ')!.stale).toBe(true);
  });

  it('grava só na org e com o nome de quem lançou', async () => {
    const prisma = makePrisma();
    const out = await new ExchangeRatesService(prisma as never).setManual('org1', 'u1', 'az', 5.88, NOW);
    expect(out).toEqual({ value: 5.88, updatedAt: NOW.toISOString(), updatedByName: 'Kleber' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('recusa operadora automática e valor fora da faixa', async () => {
    const svc = new ExchangeRatesService(makePrisma() as never);
    await expect(svc.setManual('org1', 'u1', 'JT', 6, NOW)).rejects.toThrow('atualizada automaticamente');
    await expect(svc.setManual('org1', 'u1', 'AZ', 58.8, NOW)).rejects.toThrow('Câmbio inválido');
  });
});
