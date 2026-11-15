import { ContactPersonalDataService } from './personal-data.service';

function setup(row: any = null) {
  const prisma = {
    contactPersonalData: {
      findFirst: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
  return { prisma, svc: new ContactPersonalDataService(prisma) };
}

describe('ContactPersonalDataService', () => {
  it('lê escopado por org e devolve como campos do modelo', async () => {
    const { prisma, svc } = setup({ cpf: '123', rg: null });
    expect(await svc.findValues('org-1', 'ct-1')).toEqual({ '[CPF do Cliente]': '123' });
    expect(prisma.contactPersonalData.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contactId: 'ct-1', organizationId: 'org-1' },
    }));
  });

  it('grava só campos mapeados e não vazios, sem apagar com vazio', async () => {
    const { prisma, svc } = setup();
    const count = await svc.saveFromValues('org-1', 'ct-1', {
      '[CPF do Cliente]': '123', '[RG do Cliente]': '', '[Valor Total]': 'R$ 1',
    }, 'u-1');
    expect(count).toBe(1);
    expect(prisma.contactPersonalData.upsert).toHaveBeenCalledWith({
      where: { contactId: 'ct-1' },
      create: { contactId: 'ct-1', organizationId: 'org-1', cpf: '123', updatedById: 'u-1' },
      update: { cpf: '123', updatedById: 'u-1' },
    });
  });

  it('nada a gravar → não toca no banco', async () => {
    const { prisma, svc } = setup();
    expect(await svc.saveFromValues('org-1', 'ct-1', { '[RG do Cliente]': ' ' }, 'u-1')).toBe(0);
    expect(prisma.contactPersonalData.upsert).not.toHaveBeenCalled();
  });
});
