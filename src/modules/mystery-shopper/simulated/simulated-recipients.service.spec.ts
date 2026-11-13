import { SimulatedRecipients } from './simulated-recipients.service';

describe('SimulatedRecipients', () => {
  function build(overrides: { contactChannel?: any; number?: any; conversation?: any } = {}) {
    const prisma = {
      contactChannel: { findUnique: jest.fn().mockResolvedValue(overrides.contactChannel ?? null) },
      mysteryShopperNumber: { findFirst: jest.fn().mockResolvedValue(overrides.number ?? null) },
      conversation: { findUnique: jest.fn().mockResolvedValue(overrides.conversation ?? null) },
    };
    return { service: new SimulatedRecipients(prisma as any), prisma };
  }

  it('é simulado quando o contato do canal tem número simulado', async () => {
    const { service, prisma } = build({ contactChannel: { contactId: 'c1' }, number: { id: 'n1' } });
    await expect(service.isSimulated('ch1', '5511912345678')).resolves.toBe(true);
    expect(prisma.contactChannel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uq_contact_channel_external: { channelId: 'ch1', externalId: '5511912345678' } },
      }),
    );
    expect(prisma.mysteryShopperNumber.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'c1', isSimulated: true } }),
    );
  });

  it('não é simulado para contato marcado como cliente oculto com chip real', async () => {
    const { service } = build({ contactChannel: { contactId: 'c1' }, number: null });
    await expect(service.isSimulated('ch1', '5511999990000')).resolves.toBe(false);
  });

  it('não é simulado quando o contato do canal não existe', async () => {
    const { service, prisma } = build();
    await expect(service.isSimulated('ch1', 'x')).resolves.toBe(false);
    expect(prisma.mysteryShopperNumber.findFirst).not.toHaveBeenCalled();
  });

  it('isSimulatedContact consulta pelo contactId (removido ou não)', async () => {
    const { service, prisma } = build({ number: { id: 'n1' } });
    await expect(service.isSimulatedContact('c1')).resolves.toBe(true);
    expect(prisma.mysteryShopperNumber.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contactId: 'c1', isSimulated: true } }),
    );
  });

  it('isSimulatedConversation resolve o contato da conversa', async () => {
    const { service } = build({ conversation: { contactId: 'c1' }, number: { id: 'n1' } });
    await expect(service.isSimulatedConversation('cv1')).resolves.toBe(true);
  });

  it('isSimulatedConversation é falso para conversa inexistente', async () => {
    const { service } = build();
    await expect(service.isSimulatedConversation('nada')).resolves.toBe(false);
  });
});
