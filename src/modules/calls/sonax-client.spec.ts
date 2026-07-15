import { Test } from '@nestjs/testing';
import { SonaxClient } from './sonax-client';

describe('SonaxClient DI', () => {
  it('é construído pelo Nest sem provider de fetch (não quebra o boot)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SonaxClient],
    }).compile();
    expect(moduleRef.get(SonaxClient)).toBeInstanceOf(SonaxClient);
  });
});

describe('SonaxClient.click2call', () => {
  const OK = { ok: true, status: 200, text: async () => '1' } as any;

  it('monta a URL com numero, ramal, token e var_1', async () => {
    const fetchMock = jest.fn().mockResolvedValue(OK);
    const client = new SonaxClient(fetchMock);
    await client.click2call({
      baseUrl: 'https://click2call.sonax.net.br/sonax-click2call.php',
      numero: '5511999998888',
      ramal: '101',
      token: 'TOK123',
      var1: 'call_abc',
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('numero=5511999998888');
    expect(url).toContain('ramal=101');
    expect(url).toContain('token=TOK123');
    expect(url).toContain('var_1=call_abc');
  });

  it('lança quando a Sonax responde não-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    const client = new SonaxClient(fetchMock);
    await expect(
      client.click2call({ baseUrl: 'https://x', numero: '1', ramal: '1', token: 't', var1: 'c' }),
    ).rejects.toThrow();
  });

  it('NÃO lança em timeout/abort — o click2call segura a conexão durante a ligação; o resultado vem pelo webhook', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = jest.fn().mockRejectedValue(abortErr);
    const client = new SonaxClient(fetchMock);
    await expect(
      client.click2call({ baseUrl: 'https://x', numero: '1', ramal: '1', token: 't', var1: 'c' }),
    ).resolves.toBeUndefined();
  });

  it('lança em erro de rede real (não-abort)', async () => {
    const netErr = new Error('ECONNREFUSED');
    const fetchMock = jest.fn().mockRejectedValue(netErr);
    const client = new SonaxClient(fetchMock);
    await expect(
      client.click2call({ baseUrl: 'https://x', numero: '1', ramal: '1', token: 't', var1: 'c' }),
    ).rejects.toThrow();
  });
});
