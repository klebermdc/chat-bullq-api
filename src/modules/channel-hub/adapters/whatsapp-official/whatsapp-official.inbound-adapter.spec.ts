import { WhatsAppOfficialInboundAdapter } from './whatsapp-official.inbound-adapter';
import { WhatsAppOfficialMessageMapper } from './whatsapp-official.message-mapper';
import { MessageContentType } from '../../ports/types';

describe('WhatsAppOfficialMessageMapper.normalizeInbound — respostas de botão', () => {
  const mapper = new WhatsAppOfficialMessageMapper();

  it('captura o texto do botão de TEMPLATE (type: button)', () => {
    const r = mapper.normalizeInbound(
      {
        id: 'wamid.1',
        from: '5511999999999',
        timestamp: '1700000000',
        type: 'button',
        button: { payload: 'CONTINUAR', text: 'Sim, quero continuar' },
      },
      {},
    );
    expect(r!.type).toBe(MessageContentType.INTERACTIVE);
    expect(r!.content.text).toBe('Sim, quero continuar');
    expect(r!.content.interactive?.payload).toBe('CONTINUAR');
  });

  it('captura o título do button_reply (interactive)', () => {
    const r = mapper.normalizeInbound(
      {
        id: 'wamid.2',
        from: '5511999999999',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn_1', title: 'Confirmar' },
        },
      },
      {},
    );
    expect(r!.type).toBe(MessageContentType.INTERACTIVE);
    expect(r!.content.text).toBe('Confirmar');
    expect(r!.content.interactive?.buttonId).toBe('btn_1');
  });
});

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
