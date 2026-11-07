import { BadRequestException } from '@nestjs/common';
import { WebsiteLeadSettingsService } from './website-lead-settings.service';
import { hashLeadToken } from './website-lead-token';

function make(row: any = null) {
  const prisma = {
    websiteLeadSettings: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue({}),
    },
    channel: {
      findMany: jest.fn().mockResolvedValue([{ id: 'ch-old', name: 'Antigo' }, { id: 'ch-5198', name: 'OFP' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'ch-5198' }),
    },
    messageTemplate: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'tpl-1', channelId: 'ch-5198', name: 'lead_site_retorno', displayName: null, status: 'APPROVED', category: 'MARKETING' },
      ]),
      findFirst: jest.fn().mockResolvedValue({ channelId: 'ch-5198' }),
    },
    aiAgentChannel: { findFirst: jest.fn().mockResolvedValue({ channelId: 'ch-5198' }) },
    leadSubmission: {
      groupBy: jest.fn().mockResolvedValue([{ followupStatus: 'SENT', _count: { _all: 3 } }]),
    },
  } as any;
  return { service: new WebsiteLeadSettingsService(prisma), prisma };
}

describe('WebsiteLeadSettingsService', () => {
  it('sem configuração salva sugere o canal com IA e o template lead_site_retorno, desligado', async () => {
    const { service } = make();
    const view = await service.get('org-1');
    expect(view).toMatchObject({
      enabled: false,
      channelId: 'ch-5198',
      templateId: 'tpl-1',
      delayMinutes: 5,
      hasToken: false,
      stats: { SENT: 3 },
    });
  });

  it('não liga sem canal e template', async () => {
    const { service } = make({ organizationId: 'org-1', enabled: false, channelId: null, templateId: null, delayMinutes: 5 });
    await expect(service.update('org-1', { enabled: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa template de outro canal', async () => {
    const { service, prisma } = make();
    prisma.messageTemplate.findFirst.mockResolvedValue({ channelId: 'outro' });
    await expect(service.update('org-1', { templateId: 'tpl-x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('salva canal, template, minutos e liga', async () => {
    const { service, prisma } = make();
    await service.update('org-1', { enabled: true, delayMinutes: 10 });
    expect(prisma.websiteLeadSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { organizationId: 'org-1', enabled: true, channelId: 'ch-5198', templateId: 'tpl-1', delayMinutes: 10 },
      }),
    );
  });

  it('rotateToken guarda só o hash e devolve o token uma vez, com os caminhos do Elementor', async () => {
    const { service, prisma } = make();
    const res = await service.rotateToken('org-1');
    const saved = prisma.websiteLeadSettings.upsert.mock.calls[0][0].update;
    expect(saved.tokenHash).toBe(hashLeadToken(res.token));
    expect(JSON.stringify(saved)).not.toContain(res.token);
    expect(res.webhookPath).toContain(encodeURIComponent(res.token).replace(/%2D/g, '-'));
    expect(res.webhookPathGuiamento).toContain('form=guiamento');
  });

  it('findByToken procura pelo hash e ignora token vazio', async () => {
    const { service, prisma } = make({ organizationId: 'org-1' });
    expect(await service.findByToken('')).toBeNull();
    await service.findByToken('wl_tokenzinho_valido');
    expect(prisma.websiteLeadSettings.findUnique).toHaveBeenLastCalledWith({
      where: { tokenHash: hashLeadToken('wl_tokenzinho_valido') },
    });
  });
});
