import { ChannelsService } from './channels.service';

const ativo = {
  id: 'ch1',
  name: 'Comercial',
  organizationId: 'org1',
  isActive: true,
  config: { sessionId: 'S1' },
};
const inativo = {
  id: 'ch2',
  name: 'Suporte',
  organizationId: 'org1',
  isActive: false,
  config: { sessionId: 'S2' },
};

const build = (canais: any[]) => {
  const repository = {
    findByTypeIncludingInactive: jest.fn().mockResolvedValue(canais),
  };
  // ChannelsService tem 9 deps no construtor; só a 1ª (repository) é exercitada
  // por resolveByLocator, as outras 8 nunca são tocadas neste teste.
  const service = new ChannelsService(
    repository as any,      // ChannelsRepository
    undefined as any,       // ChannelAdapterRegistry
    undefined as any,       // ZappfyHttpClient
    undefined as any,       // WasenderHttpClient
    undefined as any,       // WhatsAppOfficialHttpClient
    undefined as any,       // InstagramHttpClient
    undefined as any,       // ChannelSyncOrchestrator
    undefined as any,       // PrismaService
    undefined as any,       // ChannelAccessService
  );
  return { repository, service };
};

const bySession = (id: string) => (c: any) => c.config?.sessionId === id;

describe('ChannelsService.resolveByLocator', () => {
  it('devolve o canal com active: true quando está ativo', async () => {
    const { service } = build([ativo, inativo]);

    const res = await service.resolveByLocator('WHATSAPP_WASENDER' as any, bySession('S1'));

    expect(res).toEqual({ channel: ativo, active: true });
  });

  it('devolve o canal com active: false em vez de null quando está desativado', async () => {
    const { service } = build([ativo, inativo]);

    const res = await service.resolveByLocator('WHATSAPP_WASENDER' as any, bySession('S2'));

    // era exatamente isso que sumia antes: canal inativo virava null
    expect(res).toEqual({ channel: inativo, active: false });
  });

  it('devolve null quando nenhum canal casa', async () => {
    const { service } = build([ativo, inativo]);

    const res = await service.resolveByLocator('WHATSAPP_WASENDER' as any, bySession('S9'));

    expect(res).toBeNull();
  });
});
