import { ContractsImportService } from './contracts-import.service';

function make(opts: { existingStat?: { size: number } | null } = {}) {
  const prisma = {
    contract: { upsert: jest.fn().mockResolvedValue({}) },
    contractBlockedDate: { upsert: jest.fn().mockResolvedValue({}) },
    contractSettings: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
  const storage = {
    stat: jest.fn().mockResolvedValue(opts.existingStat ?? null),
    put: jest.fn().mockResolvedValue(undefined),
  } as any;
  return { service: new ContractsImportService(prisma, storage), prisma, storage };
}

const ROW = {
  id: 'legacy-1',
  nome_completo: 'Cliente',
  cpf: '1',
  endereco: 'R',
  cep: 'C',
  email: 'e@x.com',
  telefone: 'T',
  datas_requeridas: 'D',
  nome_guia: 'Kleber',
  vendedor: null,
  quantidade_dias: 1,
  quantidade_pessoas: 2,
  valor: '100,00',
  pix_key: null,
  hospede_disney: false,
  comprado: false,
  pago: false,
  nf_emitida: false,
  umbler_chat_url: null,
  acceptance_token: 'tok',
  accepted_at: null,
  client_ip: null,
  client_user_agent: null,
  signature_url: null,
  signed_contract_url: null,
  payment_receipt_url: null,
  created_at: '2026-01-03T19:50:57.20986+00:00',
};

describe('ContractsImportService', () => {
  it('faz upsert de contrato pela chave (org, legacyId)', async () => {
    const { service, prisma } = make();

    const result = await service.importContracts('org1', [ROW]);

    expect(result).toEqual({ imported: 1 });
    const arg = prisma.contract.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      organizationId_legacyId: { organizationId: 'org1', legacyId: 'legacy-1' },
    });
    expect(arg.create.fullName).toBe('Cliente');
    expect(arg.update.fullName).toBe('Cliente');
    expect(arg.update.organizationId).toBeUndefined();
  });

  it('rejeita o lote inteiro se uma linha é inválida', async () => {
    const { service, prisma } = make();

    await expect(
      service.importContracts('org1', [ROW, { ...ROW, id: 'legacy-2', cpf: '' }]),
    ).rejects.toThrow(/legacy-2/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('datas bloqueadas: upsert por (org, guia, data)', async () => {
    const { service, prisma } = make();

    await service.importBlockedDates('org1', [
      { guide_name: 'Rafael', blocked_date: '2026-03-01', reason: 'lotado', created_at: '2026-02-01T00:00:00Z' },
    ]);

    expect(prisma.contractBlockedDate.upsert.mock.calls[0][0].where).toEqual({
      organizationId_guideName_date: {
        organizationId: 'org1',
        guideName: 'Rafael',
        date: new Date('2026-03-01T00:00:00.000Z'),
      },
    });
  });

  it('termos: upsert por organização', async () => {
    const { service, prisma } = make();

    await service.importSettings('org1', 'Termos X');

    expect(prisma.contractSettings.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      create: { organizationId: 'org1', terms: 'Termos X' },
      update: { terms: 'Termos X' },
    });
  });

  it('arquivo novo é gravado com a chave contracts/<org>/<caminho>', async () => {
    const { service, storage } = make();

    const r = await service.importFile('org1', 'receipts/a b.pdf', Buffer.from('pdf'));

    expect(r).toEqual({ key: 'contracts/org1/receipts/a b.pdf', status: 'stored' });
    expect(storage.put).toHaveBeenCalledWith('contracts/org1/receipts/a b.pdf', Buffer.from('pdf'), 'application/pdf');
  });

  it('arquivo já existente com o mesmo tamanho não é regravado', async () => {
    const { service, storage } = make({ existingStat: { size: 3 } });

    const r = await service.importFile('org1', 'signatures/a.png', Buffer.from('png'));

    expect(r.status).toBe('exists');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('recusa caminho com ..', async () => {
    const { service } = make();
    await expect(service.importFile('org1', '../etc/passwd', Buffer.from('x'))).rejects.toThrow();
  });
});
