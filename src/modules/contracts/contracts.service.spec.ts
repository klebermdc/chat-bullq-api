import { ConflictException, NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service';

function make(existing: any = null) {
  const repo = {
    findPage: jest.fn().mockResolvedValue([[], 0]),
    findInOrg: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'c1', ...data })),
    updateInOrg: jest.fn().mockImplementation((_o, _i, data) => Promise.resolve({ ...existing, ...data })),
    deleteInOrg: jest.fn().mockResolvedValue(true),
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  return { service: new ContractsService(repo, realtime), repo, realtime };
}

const DTO = {
  fullName: 'Cliente Teste',
  cpf: '000.000.000-00',
  address: 'Rua Teste, 123',
  cep: '00000-000',
  email: 'c@example.com',
  phone: '(11) 90000-0000',
  guideName: 'Kleber',
  people: 2,
  amount: '2190,00',
  disneyGuest: false,
  datesToBeDefined: false,
  parkDates: [{ parkId: 'epcot', date: '2026-12-02' }],
};

describe('ContractsService', () => {
  it('create gera token no servidor, texto de datas e dias', async () => {
    const { service, repo, realtime } = make();
    await service.create('org1', 'user1', DTO as any);
    const data = repo.create.mock.calls[0][0];
    expect(data.organizationId).toBe('org1');
    expect(data.createdById).toBe('user1');
    expect(data.acceptanceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.requestedDates).toBe('02/12/2026 - EPCOT');
    expect(data.days).toBe(1);
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:changed', expect.objectContaining({ id: 'c1' }));
  });

  it('datas a definir: dias 0 e sem parkDates', async () => {
    const { service, repo } = make();
    await service.create('org1', 'u', { ...DTO, datesToBeDefined: true, parkDates: [] } as any);
    const data = repo.create.mock.calls[0][0];
    expect(data.days).toBe(0);
    expect(data.requestedDates).toBe('Datas a definir');
  });

  it('exige ao menos uma data quando não é "a definir"', async () => {
    const { service } = make();
    await expect(service.create('org1', 'u', { ...DTO, parkDates: [] } as any)).rejects.toThrow(/data/i);
  });

  it('update em contrato aceito é recusado', async () => {
    const { service } = make({ id: 'c1', acceptedAt: new Date() });
    await expect(service.update('org1', 'c1', { fullName: 'X Y Z' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('update recalcula texto e dias quando as datas mudam, sem tocar em arquivos', async () => {
    const { service, repo } = make({ id: 'c1', acceptedAt: null });
    await service.update('org1', 'c1', { parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], datesToBeDefined: false });
    const data = repo.updateInOrg.mock.calls[0][2];
    expect(data.requestedDates).toBe('02/12/2026 - EPCOT');
    expect(data.days).toBe(1);
    expect(data).not.toHaveProperty('signedContractKey');
  });

  it('contrato de outra org dá 404', async () => {
    const { service } = make(null);
    await expect(service.get('org1', 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('flags podem mudar mesmo depois do aceite', async () => {
    const { service, repo } = make({ id: 'c1', acceptedAt: new Date() });
    await service.updateFlags('org1', 'c1', { paid: true });
    expect(repo.updateInOrg).toHaveBeenCalledWith('org1', 'c1', { paid: true });
  });

  it('novo link troca o token; recusado depois do aceite', async () => {
    const ok = make({ id: 'c1', acceptedAt: null });
    const r = await ok.service.regenerateToken('org1', 'c1');
    expect(r.acceptanceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const accepted = make({ id: 'c1', acceptedAt: new Date() });
    await expect(accepted.service.regenerateToken('org1', 'c1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('list monta where com org, guia, status, busca e mês', async () => {
    const { service, repo } = make();
    await service.list('org1', { guide: 'Kleber', status: 'paid', q: 'ana', year: 2026, month: 2, page: 2, perPage: 10 });
    const [where, skip, take] = repo.findPage.mock.calls[0];
    expect(where.organizationId).toBe('org1');
    expect(where.guideName).toEqual({ equals: 'Kleber', mode: 'insensitive' });
    expect(where.createdAt).toEqual({ gte: new Date('2026-02-01T00:00:00Z'), lt: new Date('2026-03-01T00:00:00Z') });
    expect(JSON.stringify(where)).toContain('paymentReceiptKey');
    expect(JSON.stringify(where)).toContain('ana');
    expect([skip, take]).toEqual([10, 10]);
  });

  it('moveDate troca a data no parkDates', async () => {
    const { service, repo } = make({
      id: 'c1', acceptedAt: null, parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], requestedDates: '', createdAt: new Date(),
    });
    await service.moveDate('org1', 'c1', { from: '2026-12-02', to: '2026-12-05' });
    const data = repo.updateInOrg.mock.calls[0][2];
    expect(data.parkDates).toEqual([{ parkId: 'epcot', date: '2026-12-05' }]);
    expect(data.requestedDates).toBe('05/12/2026 - EPCOT');
  });
});
