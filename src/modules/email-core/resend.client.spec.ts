import { ResendClient } from './resend.client';

function makeFakeSdk(impl: any) {
  return { emails: { send: jest.fn(impl) } };
}

const cfg = {
  apiKey: 're_test_123',
  webhookSecret: 'whsec_x',
  from: 'marketing@exemplo.com.br',
  unsubscribeSecret: 's',
  publicUrl: 'https://app.exemplo.com.br',
  apiUrl: 'https://api.exemplo.com.br',
};

const payload = {
  to: 'joao@exemplo.com',
  subject: 'Oi',
  html: '<p>oi</p>',
  text: 'oi',
  unsubscribePostUrl: 'https://app.exemplo.com.br/api/v1/public/unsubscribe/tok',
};

describe('ResendClient', () => {
  it('devolve o id do provedor quando o envio dá certo', async () => {
    const sdk = makeFakeSdk(async () => ({ data: { id: 'resend_abc' }, error: null }));
    await expect(new ResendClient(cfg, sdk as any).send(payload)).resolves.toEqual({
      providerId: 'resend_abc',
    });
  });

  it('manda List-Unsubscribe para o Gmail mostrar o botão nativo', async () => {
    const sdk = makeFakeSdk(async () => ({ data: { id: 'r1' }, error: null }));
    await new ResendClient(cfg, sdk as any).send(payload);
    const arg = sdk.emails.send.mock.calls[0][0];
    expect(arg.headers['List-Unsubscribe']).toContain(payload.unsubscribePostUrl);
    expect(arg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(arg.from).toBe(cfg.from);
  });

  it('o header List-Unsubscribe aponta para a API (aceita POST), não para a página web', async () => {
    const sdk = makeFakeSdk(async () => ({ data: { id: 'r1' }, error: null }));
    await new ResendClient(cfg, sdk as any).send(payload);
    const arg = sdk.emails.send.mock.calls[0][0];
    expect(arg.headers['List-Unsubscribe']).toContain('/api/v1/public/unsubscribe/');
    expect(arg.headers['List-Unsubscribe']).not.toContain('/descadastro/');
  });

  it('usa fromName quando informado, mantendo o endereço da env', async () => {
    const sdk = makeFakeSdk(async () => ({ data: { id: 'r1' }, error: null }));
    await new ResendClient(cfg, sdk as any).send({ ...payload, fromName: 'Orlando Fast Pass' });
    expect(sdk.emails.send.mock.calls[0][0].from).toBe('Orlando Fast Pass <marketing@exemplo.com.br>');
  });

  it('propaga o motivo REAL devolvido pelo Resend, não uma mensagem genérica', async () => {
    const sdk = makeFakeSdk(async () => ({
      data: null,
      error: { name: 'validation_error', message: 'The domain is not verified' },
    }));
    await expect(new ResendClient(cfg, sdk as any).send(payload)).rejects.toThrow(
      /The domain is not verified/,
    );
  });

  it('propaga o motivo real quando a SDK lança exceção', async () => {
    const sdk = makeFakeSdk(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.resend.com');
    });
    await expect(new ResendClient(cfg, sdk as any).send(payload)).rejects.toThrow(/ENOTFOUND/);
  });

  it('falha alto se o Resend responder sem id', async () => {
    const sdk = makeFakeSdk(async () => ({ data: {}, error: null }));
    await expect(new ResendClient(cfg, sdk as any).send(payload)).rejects.toThrow(/sem id/);
  });
});

describe('ResendClient.sendTransactional', () => {
  const config = { apiKey: 'k', from: 'Sendtur <no-reply@x.com>' } as any;
  const tx = { to: 'a@b.com', subject: 'S', html: '<p>x</p>', text: 'x' };

  it('envia sem cabeçalhos de descadastro', async () => {
    const sdk = { emails: { send: jest.fn().mockResolvedValue({ data: { id: 'e1' } }) } };
    const client = new ResendClient(config, sdk);
    await expect(client.sendTransactional(tx)).resolves.toEqual({ providerId: 'e1' });
    const arg = sdk.emails.send.mock.calls[0][0];
    expect(arg.headers).toBeUndefined();
    expect(arg.from).toBe('Sendtur <no-reply@x.com>');
  });

  it('usa fromName quando informado', async () => {
    const sdk = { emails: { send: jest.fn().mockResolvedValue({ data: { id: 'e1' } }) } };
    await new ResendClient(config, sdk).sendTransactional({ ...tx, fromName: 'Ops' });
    expect(sdk.emails.send.mock.calls[0][0].from).toBe('Ops <Sendtur <no-reply@x.com>>');
  });

  it('erro do provedor vira exceção com o motivo', async () => {
    const sdk = { emails: { send: jest.fn().mockResolvedValue({ error: { name: 'x', message: 'bad' } }) } };
    await expect(new ResendClient(config, sdk).sendTransactional(tx)).rejects.toThrow(/bad/);
  });
});
