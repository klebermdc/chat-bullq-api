import { TelegramClient } from './telegram.client';

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: { chat_id: string; text: string } }> = [];
  const fn = jest.fn(async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = responses.shift() ?? { status: 200, body: { ok: true } };
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('TelegramClient', () => {
  it('sem token devolve erro e não chama a API', async () => {
    const { fn, calls } = fakeFetch([]);
    const client = new TelegramClient('', fn);
    expect(client.isConfigured()).toBe(false);
    expect(await client.sendMessage('1', 'oi')).toEqual({ ok: false, error: 'TELEGRAM_BOT_TOKEN ausente' });
    expect(calls).toHaveLength(0);
  });

  it('envia em HTML para o chat', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { ok: true } }]);
    expect(await new TelegramClient('T', fn).sendMessage('42', '<b>oi</b>')).toEqual({ ok: true });
    expect(calls[0].url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(calls[0].body).toMatchObject({ chat_id: '42', text: '<b>oi</b>', parse_mode: 'HTML' });
  });

  it('quebra texto longo em várias mensagens', async () => {
    const { fn, calls } = fakeFetch([]);
    const text = Array.from({ length: 3 }, () => 'x'.repeat(3000)).join('\n');
    await new TelegramClient('T', fn).sendMessage('42', text);
    expect(calls).toHaveLength(3);
  });

  it('devolve a descrição do erro da API', async () => {
    const { fn } = fakeFetch([{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }]);
    expect(await new TelegramClient('T', fn).sendMessage('42', 'oi')).toEqual({
      ok: false,
      error: 'Forbidden: bot was blocked by the user',
    });
  });

  it('erro de rede vira ok:false', async () => {
    const fn = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await new TelegramClient('T', fn).sendMessage('42', 'oi')).toEqual({ ok: false, error: 'ECONNRESET' });
  });
});
