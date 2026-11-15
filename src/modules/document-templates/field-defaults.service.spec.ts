import { BadRequestException } from '@nestjs/common';
import { FieldDefaultsService } from './field-defaults.service';

function setup(settings: any = null, bodies: string[] = ['[Cidade] [UF] [CNPJ da Agência] [Nome do Cliente]']) {
  const prisma = {
    contractSettings: {
      findUnique: jest.fn().mockResolvedValue(settings),
      upsert: jest.fn().mockImplementation(async ({ create, update }: any) => ({
        companyName: settings?.companyName ?? null,
        companyDocument: settings?.companyDocument ?? null,
        companyAddress: settings?.companyAddress ?? null,
        fieldDefaults: settings ? update.fieldDefaults : create.fieldDefaults,
      })),
    },
    documentTemplate: { findMany: jest.fn().mockResolvedValue(bodies.map((body) => ({ body }))) },
  } as any;
  return { prisma, svc: new FieldDefaultsService(prisma) };
}

describe('FieldDefaultsService.get', () => {
  it('sem contract_settings: valores vazios e campos de agência dos modelos ativos da org', async () => {
    const { prisma, svc } = setup();
    expect(await svc.get('org-1')).toEqual({ values: {}, suggestedFields: ['[Cidade]', '[CNPJ da Agência]', '[UF]'] });
    expect(prisma.documentTemplate.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', isActive: true },
      select: { body: true },
    });
  });

  it('CNPJ sai das sugestões quando a coluna própria tem valor', async () => {
    const { svc } = setup({ companyDocument: '12', fieldDefaults: { '[Cidade]': 'SP', lixo: 1 } });
    expect(await svc.get('org-1')).toEqual({ values: { '[Cidade]': 'SP' }, suggestedFields: ['[Cidade]', '[UF]'] });
  });
});

describe('FieldDefaultsService.update', () => {
  it('cria a linha com termo vazio quando a org ainda não tem', async () => {
    const { prisma, svc } = setup();
    const out = await svc.update('org-1', { '[Cidade]': ' São Paulo ', '[UF]': '' });
    expect(prisma.contractSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
      create: { organizationId: 'org-1', terms: '', fieldDefaults: { '[Cidade]': 'São Paulo' } },
      update: { fieldDefaults: { '[Cidade]': 'São Paulo' } },
    }));
    expect(out.values).toEqual({ '[Cidade]': 'São Paulo' });
  });

  it('junta ao gravado: vazio remove, ausente fica', async () => {
    const { prisma, svc } = setup({ fieldDefaults: { '[Cidade]': 'SP', '[UF]': 'SP' } });
    await svc.update('org-1', { '[UF]': '', '[Prazo de Cancelamento]': '30 dias' });
    expect(prisma.contractSettings.upsert.mock.calls[0][0].update).toEqual({
      fieldDefaults: { '[Cidade]': 'SP', '[Prazo de Cancelamento]': '30 dias' },
    });
  });

  it('passar de 80 campos no total → 400 sem gravar', async () => {
    const current = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`[C${i}]`, 'v']));
    const { prisma, svc } = setup({ fieldDefaults: current });
    await expect(svc.update('org-1', { '[Novo]': 'x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contractSettings.upsert).not.toHaveBeenCalled();
  });
});
