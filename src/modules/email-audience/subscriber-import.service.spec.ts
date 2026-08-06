import { EmailSubscriberSource } from '@prisma/client';
import { SubscriberImportService, aggregateSalesOrders, parseCsv, SalesOrderRow } from './subscriber-import.service';

describe('parseCsv', () => {
  it('lê email e nome, descartando o cabeçalho', () => {
    expect(parseCsv('email,nome\njoao@exemplo.com,João\nmaria@exemplo.com,Maria')).toEqual([
      { email: 'joao@exemplo.com', name: 'João' },
      { email: 'maria@exemplo.com', name: 'Maria' },
    ]);
  });

  it('aceita ponto e vírgula como separador', () => {
    expect(parseCsv('joao@exemplo.com;João')).toEqual([{ email: 'joao@exemplo.com', name: 'João' }]);
  });

  it('ignora linhas em branco', () => {
    expect(parseCsv('joao@exemplo.com\n\n  \n')).toHaveLength(1);
  });

  it('devolve a linha malformada em vez de descartar em silêncio', () => {
    expect(parseCsv('joao@exemplo.com\nlinha-sem-arroba')).toEqual([
      { email: 'joao@exemplo.com', name: undefined },
      { email: 'linha-sem-arroba', name: undefined },
    ]);
  });
});

describe('aggregateSalesOrders', () => {
  function order(overrides: Partial<SalesOrderRow>): SalesOrderRow {
    return {
      emailCliente: 'joao@exemplo.com',
      cliente: 'João',
      venda: 100,
      produto: 'Ingresso',
      fornecedor: 'Just Travel',
      data: new Date('2026-01-01'),
      ...overrides,
    };
  }

  it('nove pedidos da mesma pessoa viram UM destinatário, com orderCount = 9', () => {
    const orders = Array.from({ length: 9 }, (_, i) =>
      order({ data: new Date(2026, 0, i + 1) }),
    );
    const [customer] = aggregateSalesOrders(orders);
    expect(aggregateSalesOrders(orders)).toHaveLength(1);
    expect(customer.orderCount).toBe(9);
  });

  it('totalSpent é a soma de venda, tratando nulo como zero', () => {
    const orders = [order({ venda: 100 }), order({ venda: null }), order({ venda: 250.5 })];
    const [customer] = aggregateSalesOrders(orders);
    expect(customer.totalSpent).toBe(350.5);
  });

  it('categories reúne as categorias de todos os pedidos, sem repetição', () => {
    const orders = [
      order({ produto: 'Ingresso' }),
      order({ produto: 'Ingressos' }),
      order({ produto: 'Ingresso e Hotel' }),
      order({ produto: 'Guiamento' }),
    ];
    const [customer] = aggregateSalesOrders(orders);
    expect(customer.categories.sort()).toEqual(['guiamento', 'hotel', 'ingresso']);
  });

  it('lastPurchaseAt é a data mais recente válida — data zerada não vira a mais antiga', () => {
    const orders = [
      order({ data: new Date('2026-03-01') }),
      order({ data: new Date('1969-12-31') }), // marco zero — lixo
      order({ data: new Date('2026-06-15') }),
    ];
    const [customer] = aggregateSalesOrders(orders);
    expect(customer.firstPurchaseAt).toEqual(new Date('2026-03-01'));
    expect(customer.lastPurchaseAt).toEqual(new Date('2026-06-15'));
  });

  it('pessoa com todas as datas inválidas fica com first/lastPurchaseAt nulos, mas é agregada', () => {
    const orders = [order({ data: new Date('1969-12-31') }), order({ data: null })];
    const [customer] = aggregateSalesOrders(orders);
    expect(customer.firstPurchaseAt).toBeNull();
    expect(customer.lastPurchaseAt).toBeNull();
    expect(customer.orderCount).toBe(2);
  });

  it('pedido sem email não forma grupo', () => {
    const orders = [order({ emailCliente: null }), order({ emailCliente: '' })];
    expect(aggregateSalesOrders(orders)).toHaveLength(0);
  });

  it('suppliers também são normalizados e sem repetição', () => {
    const orders = [
      order({ fornecedor: ' Just Travel ' }),
      order({ fornecedor: 'JUST TRAVEL' }),
      order({ fornecedor: '-' }),
    ];
    const [customer] = aggregateSalesOrders(orders);
    expect(customer.suppliers).toEqual(['just travel']);
  });
});

describe('SubscriberImportService', () => {
  function make() {
    const upserted: any[] = [];
    const subscribers = {
      upsert: jest.fn(async (_org: string, input: any) => {
        if (!input.email.includes('@')) throw new Error('endereço inválido');
        upserted.push(input);
        return { id: `sub_${upserted.length}` };
      }),
    };
    const prisma = {
      contact: {
        findMany: jest.fn(async () => [
          { id: 'c1', email: 'joao@exemplo.com', name: 'João' },
          { id: 'c2', email: null, name: 'Sem email' },
        ]),
      },
      ofpSalesOrder: {
        findMany: jest.fn(async () => [
          {
            emailCliente: 'maria@exemplo.com',
            cliente: 'Maria',
            venda: 500,
            produto: 'Ingresso',
            fornecedor: 'Just Travel',
            data: new Date('2026-01-10'),
          },
        ]),
      },
    };
    return { service: new SubscriberImportService(prisma as any, subscribers as any), upserted };
  }

  it('importa contatos do CRM ignorando quem não tem email', async () => {
    const { service, upserted } = make();
    expect(await service.fromContacts('org_1')).toEqual({ imported: 1, skipped: 1, errors: [] });
    expect(upserted[0].source).toBe(EmailSubscriberSource.CRM_CONTACT);
    expect(upserted[0].contactId).toBe('c1');
  });

  it('importa pedidos do HUB já enriquecidos e carimbando a procedência', async () => {
    const { service, upserted } = make();
    await service.fromSalesOrders('org_1');
    expect(upserted[0].source).toBe(EmailSubscriberSource.OFP_ORDER);
    expect(upserted[0].consentSource).toBe('hub:1 pedido(s)');
    expect(upserted[0].enrichment).toEqual({
      firstPurchaseAt: new Date('2026-01-10'),
      lastPurchaseAt: new Date('2026-01-10'),
      totalSpent: 500,
      orderCount: 1,
      categories: ['ingresso'],
      suppliers: ['just travel'],
    });
  });

  it('relata as linhas rejeitadas do CSV em vez de engoli-las', async () => {
    const { service } = make();
    const r = await service.fromCsv('org_1', 'joao@exemplo.com,João\nlixo-sem-arroba,Fulano');
    expect(r.imported).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('lixo-sem-arroba');
  });

  it('uma linha ruim não aborta a importação inteira', async () => {
    const { service } = make();
    const r = await service.fromCsv('org_1', 'lixo\njoao@exemplo.com\noutro-lixo\nmaria@exemplo.com');
    expect(r.imported).toBe(2);
    expect(r.errors).toHaveLength(2);
  });
});
