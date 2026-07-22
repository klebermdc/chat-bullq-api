import { CheckPurchaseTool, phoneTail } from './check-purchase.tool';

function make(opts: { rows?: any[]; contact?: any } = {}) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(opts.rows ?? []),
    contact: {
      findUnique: jest.fn().mockResolvedValue(
        opts.contact === undefined
          ? { phone: '+55 11 98201-5967', email: 'ana@ex.com', name: 'Ana Souza' }
          : opts.contact,
      ),
    },
  } as any;
  const ctx = {
    organizationId: 'org1',
    conversationId: 'c1',
    contactId: 'ct1',
    channelId: 'ch1',
    agentId: 'a1',
    runId: 'r1',
  } as any;
  return { tool: new CheckPurchaseTool(prisma), prisma, ctx };
}

const ORDER = {
  pedido: '10432',
  cliente: 'Ana Souza',
  email_cliente: 'ana@ex.com',
  telefone_cliente: '(11) 98201-5967',
  produto: 'Universal Express 2 dias',
  status: 'Pago',
  venda: '1850.00',
  vendedor: 'Barbara',
  data: new Date('2026-06-10T12:00:00Z'),
};

describe('phoneTail', () => {
  it('reduz para os últimos 8 dígitos ignorando DDI e formatação', () => {
    expect(phoneTail('+55 (11) 98201-5967')).toBe('82015967');
    expect(phoneTail('11982015967')).toBe('82015967');
  });

  it('devolve null quando não há dígitos suficientes', () => {
    expect(phoneTail('1234')).toBeNull();
    expect(phoneTail('')).toBeNull();
    expect(phoneTail(null)).toBeNull();
  });
});

describe('CheckPurchaseTool', () => {
  it('encontra pedidos e marca o cliente como comprador', async () => {
    const { tool, ctx } = make({ rows: [ORDER] });
    const res: any = await tool.execute({ phone: '11982015967' }, ctx);

    expect(res.output.ok).toBe(true);
    expect(res.output.alreadyCustomer).toBe(true);
    expect(res.output.purchaseCount).toBe(1);
    expect(res.output.purchases[0]).toMatchObject({
      pedido: '10432',
      produto: 'Universal Express 2 dias',
      valor: 1850,
      status: 'Pago',
      vendedor: 'Barbara',
    });
    expect(res.output.purchases[0].data).toBe('2026-06-10T12:00:00.000Z');
  });

  // O runner trata `ok:false` como falha de skill e notifica a org
  // (isToolCallFailure). "Não comprou" é resposta legítima, não erro —
  // se voltasse ok:false, todo lead novo viraria alerta pro admin.
  it('não é comprador → ainda assim ok:true (não pode virar alerta de falha)', async () => {
    const { tool, ctx } = make({ rows: [] });
    const res: any = await tool.execute({ phone: '11982015967' }, ctx);

    expect(res.output.ok).toBe(true);
    expect(res.output.alreadyCustomer).toBe(false);
    expect(res.output.purchases).toEqual([]);
  });

  it('sem argumentos, usa telefone e email do próprio contato da conversa', async () => {
    const { tool, prisma, ctx } = make({ rows: [ORDER] });
    const res: any = await tool.execute({}, ctx);

    expect(prisma.contact.findUnique).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      select: { phone: true, email: true, name: true },
    });
    expect(res.output.ok).toBe(true);
    expect(res.output.searchedBy).toEqual({
      phoneTail: '82015967',
      email: 'ana@ex.com',
    });
  });

  it('normaliza email para minúsculas antes de consultar', async () => {
    const { tool, prisma, ctx } = make({ rows: [] });
    await tool.execute({ email: '  ANA@Ex.COM ' }, ctx);

    const params = prisma.$queryRaw.mock.calls[0].slice(1);
    expect(params).toContain('ana@ex.com');
  });

  it('sem telefone nem email utilizáveis, devolve ok:true pedindo o dado', async () => {
    const { tool, prisma, ctx } = make({ contact: { phone: null, email: null, name: null } });
    const res: any = await tool.execute({}, ctx);

    expect(res.output.ok).toBe(true);
    expect(res.output.alreadyCustomer).toBe(false);
    expect(res.output.needsIdentifier).toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  // Erro de banco é falha real de infra — aí sim ok:false, que acende
  // o alerta pro admin investigar.
  it('erro de banco devolve ok:false', async () => {
    const { tool, prisma, ctx } = make({ rows: [] });
    prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

    const res: any = await tool.execute({ phone: '11982015967' }, ctx);
    expect(res.output.ok).toBe(false);
    expect(res.output.error).toContain('connection reset');
  });

  it('agrega vários pedidos e reporta a compra mais recente', async () => {
    const older = { ...ORDER, pedido: '9001', data: new Date('2025-01-05T10:00:00Z') };
    const { tool, ctx } = make({ rows: [ORDER, older] });
    const res: any = await tool.execute({ phone: '11982015967' }, ctx);

    expect(res.output.purchaseCount).toBe(2);
    expect(res.output.lastPurchaseDate).toBe('2026-06-10T12:00:00.000Z');
    expect(res.output.products).toEqual(['Universal Express 2 dias']);
  });
});
