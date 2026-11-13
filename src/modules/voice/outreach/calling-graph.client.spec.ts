import { CallingGraphClient, parsePermission, waDigits } from './calling-graph.client';

const channel = { config: { accessToken: 'tok', phoneNumberId: '343333345533421' } };
const config = { get: () => undefined } as any;

describe('parsePermission', () => {
  it('lê status e se pode ligar/pedir', () => {
    expect(
      parsePermission({
        permission: { status: 'temporary', expiration: 1 },
        actions: [
          { action_name: 'start_call', can_perform_action: true },
          { action_name: 'send_call_permission_request', can_perform_action: false },
        ],
      }),
    ).toEqual({ status: 'temporary', canCall: true, canRequest: false });
    expect(parsePermission({})).toEqual({ status: 'no_permission', canCall: false, canRequest: false });
  });
});

describe('CallingGraphClient', () => {
  it('consulta a permissão com o número só em dígitos e versão v23.0', async () => {
    const urls: string[] = [];
    const c = new CallingGraphClient(config).useFetch(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ permission: { status: 'no_permission' }, actions: [] }), { status: 200 });
    });
    await expect(c.getPermission(channel, '+55 (11) 99999-0000')).resolves.toMatchObject({ canCall: false });
    expect(urls[0]).toBe('https://graph.facebook.com/v23.0/343333345533421/call_permissions?user_wa_id=5511999990000');
    expect(waDigits('+55 11 9')).toBe('55119');
  });

  it('pede permissão com mensagem interativa call_permission_request', async () => {
    let body: any;
    const c = new CallingGraphClient(config).useFetch(async (_u, init) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 });
    });
    await expect(c.requestPermission(channel, '5511999990000', 'Podemos te ligar?')).resolves.toBe('wamid.X');
    expect(body.interactive).toEqual({ type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text: 'Podemos te ligar?' } });
  });

  it('erro da Meta vira exceção legível; canal sem token falha antes', async () => {
    const c = new CallingGraphClient(config).useFetch(async () => new Response(JSON.stringify({ error: { message: 'janela fechada' } }), { status: 400 }));
    await expect(c.requestPermission(channel, '55', 'x')).rejects.toThrow('Meta 400: janela fechada');
    await expect(c.getPermission({ config: {} }, '55')).rejects.toThrow('Canal sem accessToken');
  });
});
