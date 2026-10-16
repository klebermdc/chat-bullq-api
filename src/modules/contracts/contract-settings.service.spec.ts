import { ContractSettingsService } from './contract-settings.service';

function make(row: any = null) {
  const prisma = {
    contractSettings: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockImplementation(({ create, update }) => Promise.resolve({ ...create, ...update })),
    },
    contractBlockedDate: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  return { service: new ContractSettingsService(prisma), prisma };
}

describe('ContractSettingsService', () => {
  it('get sem linha devolve padrões vazios (termos vazios)', async () => {
    const { service } = make(null);
    const s = await service.get('org1');
    expect(s).toMatchObject({ terms: '', pixKeys: [], guides: [], sellers: [], defaultPixKey: null });
  });

  it('update faz upsert só com os campos enviados', async () => {
    const { service, prisma } = make({ organizationId: 'org1', terms: 'T' });
    await service.update('org1', { receiptNotifyEmail: 'a@b.com' });
    const arg = prisma.contractSettings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: 'org1' });
    expect(arg.update).toEqual({ receiptNotifyEmail: 'a@b.com' });
    expect(arg.create).toMatchObject({ organizationId: 'org1', terms: '', receiptNotifyEmail: 'a@b.com' });
  });

  it('bloquear data é idempotente (upsert pela chave única)', async () => {
    const { service, prisma } = make();
    await service.blockDate('org1', { guideName: 'Kleber', date: '2026-12-24' });
    expect(prisma.contractBlockedDate.upsert.mock.calls[0][0].where).toEqual({
      organizationId_guideName_date: { organizationId: 'org1', guideName: 'Kleber', date: new Date('2026-12-24T00:00:00.000Z') },
    });
  });

  it('desbloquear filtra pela org e acha o guia sem diferenciar maiúsculas nem espaços', async () => {
    const { service, prisma } = make();
    await service.unblockDate('org1', '  kleber ', '2026-12-24');
    expect(prisma.contractBlockedDate.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        guideName: { equals: 'kleber', mode: 'insensitive' },
        date: new Date('2026-12-24T00:00:00.000Z'),
      },
    });
  });

  it('bloquear grava o nome do guia sem espaços nas pontas', async () => {
    const { service, prisma } = make();
    await service.blockDate('org1', { guideName: ' Kleber  ', date: '2026-12-24' });
    const arg = prisma.contractBlockedDate.upsert.mock.calls[0][0];
    expect(arg.where.organizationId_guideName_date.guideName).toBe('Kleber');
    expect(arg.create.guideName).toBe('Kleber');
  });
});
