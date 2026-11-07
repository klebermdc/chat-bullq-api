import { ManagerAlertsSender } from './manager-alerts.sender';

describe('ManagerAlertsSender', () => {
  const recipients = [
    { name: 'Renata', phone: '5511947156251' },
    { name: 'Rafael', phone: '5511966144493' },
  ];

  it('devolve wamid por destinatário e o erro da Meta sem lançar', async () => {
    const http = {
      sendMessage: jest
        .fn()
        .mockResolvedValueOnce({ messages: [{ id: 'wamid.1' }] })
        .mockRejectedValueOnce(new Error('Meta recusou o envio (132001): template não existe')),
    };
    const sender = new ManagerAlertsSender(http as never);
    const results = await sender.sendToAll(
      { id: 'ch1' } as never,
      recipients,
      { name: 'alerta_sla_gestao', language: 'pt_BR' },
      (r) => [r.name],
    );
    expect(results).toEqual([
      { phone: '5511947156251', ok: true, wamid: 'wamid.1' },
      { phone: '5511966144493', ok: false, error: 'Meta recusou o envio (132001): template não existe' },
    ]);
    expect(http.sendMessage.mock.calls[0][1]).toMatchObject({
      to: '5511947156251',
      type: 'template',
      template: { name: 'alerta_sla_gestao', language: { code: 'pt_BR' } },
    });
  });
});
