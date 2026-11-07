/**
 * Payload da Cloud API para um template HSM com variáveis só no corpo —
 * mesmo shape que o mapper do canal usa para `type: 'template'`.
 */
export function buildTemplatePayload(
  phone: string,
  templateName: string,
  language: string,
  bodyParams: ReadonlyArray<string>,
): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [
        {
          type: 'body',
          parameters: bodyParams.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  };
}
