import { OrgRole } from '@prisma/client';
import { ChannelsService } from './channels.service';

const rawChannel = {
  id: 'ch1',
  organizationId: 'org1',
  name: 'WhatsApp Principal',
  type: 'WHATSAPP_OFFICIAL',
  config: { accessToken: 'EAABsecret' },
  webhookSecret: 'hush',
  isActive: true,
};

const build = () => {
  const repository = {
    findByOrganization: jest.fn().mockResolvedValue([rawChannel]),
    findById: jest.fn().mockResolvedValue(rawChannel),
  };
  const service = new ChannelsService(
    repository as any,
    {} as any, // adapterRegistry
    {} as any, // zappfyHttpClient
    {} as any, // waOfficialHttpClient
    {} as any, // instagramHttpClient
    {} as any, // messengerHttpClient
    {} as any, // syncOrchestrator
    {} as any, // prisma
    {} as any, // channelAccess
  );
  return { repository, service };
};

describe('ChannelsService — masking de credenciais', () => {
  it('findAll mascara config/webhookSecret pro AGENT', async () => {
    const { service } = build();
    const [channel] = await service.findAll('org1', 'ALL', OrgRole.AGENT);
    expect(channel).not.toHaveProperty('config');
    expect(channel).not.toHaveProperty('webhookSecret');
  });

  it('findAll NÃO mascara pro ADMIN', async () => {
    const { service } = build();
    const [channel] = await service.findAll('org1', 'ALL', OrgRole.ADMIN);
    expect((channel as any).config).toEqual(rawChannel.config);
    expect((channel as any).webhookSecret).toBe('hush');
  });

  it('findOne mascara config/webhookSecret pro AGENT', async () => {
    const { service } = build();
    const channel = await service.findOne('ch1', 'org1', 'ALL', OrgRole.AGENT);
    expect(channel).not.toHaveProperty('config');
    expect(channel).not.toHaveProperty('webhookSecret');
  });

  it('findOne NÃO mascara pro OWNER', async () => {
    const { service } = build();
    const channel = await service.findOne('ch1', 'org1', 'ALL', OrgRole.OWNER);
    expect((channel as any).config).toEqual(rawChannel.config);
  });

  it('findOne sem role (chamador interno) retorna o canal cru — precisa do config pra falar com o provedor', async () => {
    const { service } = build();
    const channel = await service.findOne('ch1', 'org1');
    expect((channel as any).config).toEqual(rawChannel.config);
    expect((channel as any).webhookSecret).toBe('hush');
  });
});
