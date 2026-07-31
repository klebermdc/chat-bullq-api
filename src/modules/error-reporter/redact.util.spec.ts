import { redactSecrets } from './redact.util';

describe('redactSecrets', () => {
  it('oculta valor de chave sensivel no topo', () => {
    expect(redactSecrets({ token: 'abc123', channelType: 'X' })).toEqual({
      token: '<oculto>',
      channelType: 'X',
    });
  });

  it('oculta dentro de array de objetos (formato dos locators)', () => {
    expect(
      redactSecrets([{ token: 'segredo', instanceId: 'i1' }]),
    ).toEqual([{ token: '<oculto>', instanceId: 'i1' }]);
  });

  it('reconhece variacoes de nome de chave', () => {
    expect(
      redactSecrets({
        webhookSecret: 'a',
        API_KEY: 'b',
        Authorization: 'c',
        senha: 'd',
        accessToken: 'e',
      }),
    ).toEqual({
      webhookSecret: '<oculto>',
      API_KEY: '<oculto>',
      Authorization: '<oculto>',
      senha: '<oculto>',
      accessToken: '<oculto>',
    });
  });

  it('preserva o que nao e sensivel', () => {
    const entrada = {
      channelType: 'WHATSAPP_OFFICIAL',
      statusCode: 500,
      ok: false,
      nada: null,
      lista: ['a', 'b'],
    };
    expect(redactSecrets(entrada)).toEqual(entrada);
  });

  it('nao entra em laco infinito com referencia circular', () => {
    const a: Record<string, unknown> = { nome: 'a' };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });

  it('nao explode com null nem undefined', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('oculta o telefone dentro de um JID do WhatsApp', () => {
    expect(
      redactSecrets({ externalConversationId: '5511999998888@s.whatsapp.net' }),
    ).toEqual({ externalConversationId: '<telefone>@s.whatsapp.net' });
  });

  it('oculta JID dentro de array', () => {
    expect(redactSecrets(['5511999998888@c.us', 'texto normal'])).toEqual([
      '<telefone>@c.us',
      'texto normal',
    ]);
  });

  it('nao mexe em email comum', () => {
    expect(redactSecrets({ de: 'contato@empresa.com.br' })).toEqual({
      de: 'contato@empresa.com.br',
    });
  });
});
