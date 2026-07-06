import { WhatsAppOfficialInboundAdapter } from './whatsapp-official.inbound-adapter';
import { WhatsAppOfficialMessageMapper } from './whatsapp-official.message-mapper';

describe('WhatsAppOfficialInboundAdapter.parseWebhook — template status', () => {
  const adapter = new WhatsAppOfficialInboundAdapter(
    new WhatsAppOfficialMessageMapper(),
  );

  it('extrai message_template_status_update', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                message_template_id: 'META1',
                event: 'APPROVED',
                reason: null,
              },
            },
          ],
        },
      ],
    };
    const res = adapter.parseWebhook(payload as any, { id: 'ch1' } as any);
    expect(res.templateStatusUpdates).toContainEqual({
      metaTemplateId: 'META1',
      status: 'APPROVED',
      reason: undefined,
    });
  });
});
