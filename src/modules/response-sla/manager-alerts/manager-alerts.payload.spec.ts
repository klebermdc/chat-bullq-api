import { buildTemplatePayload } from './manager-alerts.payload';

describe('buildTemplatePayload', () => {
  it('monta o template HSM da Cloud API com as variáveis do corpo', () => {
    expect(
      buildTemplatePayload('5511947156251', 'placar_sla_dia', 'pt_BR', ['Renata', '82%', 'nenhum']),
    ).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511947156251',
      type: 'template',
      template: {
        name: 'placar_sla_dia',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Renata' },
              { type: 'text', text: '82%' },
              { type: 'text', text: 'nenhum' },
            ],
          },
        ],
      },
    });
  });
});
