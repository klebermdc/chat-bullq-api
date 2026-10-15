import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractsImportService } from './contracts-import.service';

function make(opts: { existingStat?: { size: number } | null; existingContracts?: any[] } = {}) {
  const prisma = {
    contract: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(opts.existingContracts ?? []),
      count: jest.fn().mockResolvedValue(0),
    },
    contractBlockedDate: { upsert: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    contractSettings: { upsert: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
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

  it('recusa extensão fora da allowlist com 400', async () => {
    const { service, storage } = make();
    await expect(service.importFile('org1', 'receipts/a.exe', Buffer.from('x'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.importFile('org1', 'receipts/semextensao', Buffer.from('x'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('arquivo existente com tamanho diferente é conflito e não sobrescreve', async () => {
    const { service, storage } = make({ existingStat: { size: 99 } });
    await expect(service.importFile('org1', 'signatures/a.png', Buffer.from('png'))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  describe('evidência de aceite', () => {
    const EVIDENCE = [
      'acceptanceToken',
      'acceptedAt',
      'clientIp',
      'clientUserAgent',
      'signatureKey',
      'signedContractKey',
      'paymentReceiptKey',
    ];
    const FULL = {
      acceptance_token: 'novo',
      accepted_at: '2026-10-15T19:30:00+00:00',
      client_ip: '9.9.9.9',
      client_user_agent: 'UA novo',
      signature_url: 'https://x/storage/v1/object/public/contract-documents/signatures/n.png',
      signed_contract_url: 'https://x/storage/v1/object/public/contract-documents/signed/n.pdf',
      payment_receipt_url: 'https://x/storage/v1/object/public/contract-documents/receipts/n.png',
    };

    it('busca o estado atual uma vez, por org e legacyIds, só com os campos de evidência', async () => {
      const { service, prisma } = make();
      await service.importContracts('org1', [ROW, { ...ROW, id: 'legacy-2', acceptance_token: 'tok2' }]);
      expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
      const arg = prisma.contract.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ organizationId: 'org1', legacyId: { in: ['legacy-1', 'legacy-2'] } });
      expect(Object.keys(arg.select).sort()).toEqual(['legacyId', ...EVIDENCE].sort());
    });

    it('não sobrescreve evidência já preenchida (nem por outro valor, nem por null) e mantém os operacionais', async () => {
      const existing = {
        legacyId: 'legacy-1',
        acceptanceToken: 'velho',
        acceptedAt: new Date('2026-01-01T00:00:00Z'),
        clientIp: '1.1.1.1',
        clientUserAgent: 'UA velho',
        signatureKey: 'contracts/org1/signatures/velha.png',
        signedContractKey: 'contracts/org1/signed/velho.pdf',
        paymentReceiptKey: 'contracts/org1/receipts/velho.png',
      };
      const { service, prisma } = make({ existingContracts: [existing] });
      await service.importContracts('org1', [{ ...ROW, ...FULL, nome_completo: 'Nome Novo', pago: true }]);
      const arg = prisma.contract.upsert.mock.calls[0][0];
      for (const f of EVIDENCE) expect(arg.update).not.toHaveProperty(f);
      expect(arg.update.fullName).toBe('Nome Novo');
      expect(arg.update.paid).toBe(true);
      expect(arg.create.acceptanceToken).toBe('novo');

      const { service: s2, prisma: p2 } = make({ existingContracts: [existing] });
      await s2.importContracts('org1', [{ ...ROW, acceptance_token: null }]);
      expect(p2.contract.upsert.mock.calls[0][0].update).not.toHaveProperty('acceptanceToken');
    });

    it('preenche lacuna: campo null no Sendtur recebe o valor do legado', async () => {
      const existing = {
        legacyId: 'legacy-1',
        acceptanceToken: 'velho',
        acceptedAt: null,
        clientIp: null,
        clientUserAgent: null,
        signatureKey: null,
        signedContractKey: null,
        paymentReceiptKey: null,
      };
      const { service, prisma } = make({ existingContracts: [existing] });
      await service.importContracts('org1', [{ ...ROW, ...FULL }]);
      const upd = prisma.contract.upsert.mock.calls[0][0].update;
      expect(upd).not.toHaveProperty('acceptanceToken');
      expect(upd.clientIp).toBe('9.9.9.9');
      expect(upd.acceptedAt).toEqual(new Date('2026-10-15T19:30:00+00:00'));
      expect(upd.signatureKey).toBe('contracts/org1/signatures/n.png');
    });

    it('contrato novo (inexistente) mantém update completo', async () => {
      const { service, prisma } = make();
      await service.importContracts('org1', [ROW]);
      expect(prisma.contract.upsert.mock.calls[0][0].update.acceptanceToken).toBe('tok');
    });
  });

  describe('conflito de chave única (P2002)', () => {
    const p2002 = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on acceptanceToken=tok', {
        code: 'P2002',
        clientVersion: 'x',
      });

    it('contratos: vira ConflictException genérica sem ecoar valores', async () => {
      const { service, prisma } = make();
      prisma.$transaction.mockRejectedValue(p2002());
      const err = await service.importContracts('org1', [ROW]).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Conflito de chave única no lote (token de aceite ou contrato duplicado)');
      expect(err.message).not.toContain('acceptanceToken=');
    });

    it('datas bloqueadas: idem', async () => {
      const { service, prisma } = make();
      prisma.$transaction.mockRejectedValue(p2002());
      await expect(
        service.importBlockedDates('org1', [
          { guide_name: 'R', blocked_date: '2026-03-01', reason: 'lotado', created_at: '2026-02-01T00:00:00Z' },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('outros erros propagam', async () => {
      const { service, prisma } = make();
      prisma.$transaction.mockRejectedValue(new Error('boom'));
      await expect(service.importContracts('org1', [ROW])).rejects.toThrow('boom');
    });
  });

  describe('status', () => {
    it('conta só contratos importados (legacyId não nulo); datas contam tudo', async () => {
      const { service, prisma } = make();
      await service.status('org1');
      expect(prisma.contract.count.mock.calls[0][0].where).toEqual({
        organizationId: 'org1',
        legacyId: { not: null },
      });
      const withFiles = prisma.contract.count.mock.calls[1][0].where;
      expect(withFiles.legacyId).toEqual({ not: null });
      expect(withFiles.OR).toHaveLength(3);
      expect(prisma.contractBlockedDate.count.mock.calls[0][0]).toEqual({ where: { organizationId: 'org1' } });
    });
  });
});
