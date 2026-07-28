import { WebhookEventsService } from './webhook-events.service';

const build = () => {
  const prisma = {
    webhookEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
    },
  };
  const service = new WebhookEventsService(prisma as any);
  return { prisma, service };
};

describe('WebhookEventsService.recordDropped', () => {
  it('grava UNROUTED com motivo e channelId', async () => {
    const { prisma, service } = build();

    const id = await service.recordDropped({
      channelType: 'WHATSAPP_OFFICIAL' as any,
      reason: 'CHANNEL_INACTIVE: canal Comercial (ch1)',
      payload: { foo: 'bar' },
      headers: { 'x-hub-signature': 'abc', authorization: 'Bearer segredo' },
      channelId: 'ch1',
    });

    expect(id).toBe('evt1');
    const data = prisma.webhookEvent.create.mock.calls[0][0].data;
    expect(data.status).toBe('UNROUTED');
    expect(data.channelId).toBe('ch1');
    expect(data.errorMessage).toBe('CHANNEL_INACTIVE: canal Comercial (ch1)');
    expect(data.rawPayload).toEqual({ foo: 'bar' });
    // headers sensíveis continuam redigidos
    expect(data.headers.authorization).toBe('[redacted]');
  });

  it('aceita drop sem canal identificado', async () => {
    const { prisma, service } = build();

    await service.recordDropped({
      channelType: 'WHATSAPP_WASENDER' as any,
      reason: 'NO_LOCATORS: canal não identificado',
      payload: {},
      headers: {},
    });

    expect(prisma.webhookEvent.create.mock.calls[0][0].data.channelId).toBeNull();
  });
});
