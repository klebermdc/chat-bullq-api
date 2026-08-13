import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { MetaOAuthClient } from './meta-oauth.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    META_ADS_APP_ID: 'app-123',
    META_ADS_APP_SECRET: 'secret-abc',
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('MetaOAuthClient', () => {
  beforeEach(() => jest.resetAllMocks());

  it('troca o token curto pelo de longa duracao numa chamada so', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'longo', expires_in: 5184000 },
    });

    const client = new MetaOAuthClient(makeConfig());
    const result = await client.exchangeUserTokenForLongLived('CURTO');

    expect(result.accessToken).toBe('longo');
    expect(result.expiresAt).toBeInstanceOf(Date);

    // Uma chamada só: o fluxo de `code` foi abandonado porque exige repetir o
    // redirect_uri interno do diálogo do SDK (OAuthException 100 / 36008).
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    const [url, cfg] = mockedAxios.get.mock.calls[0];
    expect(url).toContain('/oauth/access_token');
    expect((cfg as any).params).toMatchObject({
      grant_type: 'fb_exchange_token',
      client_id: 'app-123',
      fb_exchange_token: 'CURTO',
    });
  });

  it('nunca manda code nem redirect_uri', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'longo' } });
    const client = new MetaOAuthClient(makeConfig());
    await client.exchangeUserTokenForLongLived('CURTO');

    const [, cfg] = mockedAxios.get.mock.calls[0];
    expect((cfg as any).params).not.toHaveProperty('code');
    expect((cfg as any).params).not.toHaveProperty('redirect_uri');
  });

  it('devolve expiresAt nulo quando a Meta nao informa expires_in', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { access_token: 'longo' } });

    const client = new MetaOAuthClient(makeConfig());
    const result = await client.exchangeUserTokenForLongLived('CURTO');

    expect(result.expiresAt).toBeNull();
  });

  it('falha claro quando a Meta nao devolve access_token', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} });
    const client = new MetaOAuthClient(makeConfig());
    await expect(client.exchangeUserTokenForLongLived('CURTO')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falha claro quando as credenciais do app nao estao configuradas', async () => {
    const client = new MetaOAuthClient(makeConfig({ META_ADS_APP_ID: undefined }));
    await expect(client.exchangeUserTokenForLongLived('CURTO')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('lista ad accounts paginando ate o fim', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'act_1', name: 'Conta 1', currency: 'BRL', timezone_name: 'America/Sao_Paulo' }],
          paging: { next: 'https://graph.facebook.com/next-page' },
        },
      })
      .mockResolvedValueOnce({
        data: { data: [{ id: 'act_2', name: 'Conta 2', currency: 'USD' }] },
      });

    const client = new MetaOAuthClient(makeConfig());
    const accounts = await client.listAdAccounts('TOKEN');

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ id: 'act_1', name: 'Conta 1', currency: 'BRL' });
    expect(accounts[1]).toMatchObject({ id: 'act_2', currency: 'USD' });
  });

  it('devolve lista vazia quando a conta nao tem ad account', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { data: [] } });
    const client = new MetaOAuthClient(makeConfig());
    await expect(client.listAdAccounts('TOKEN')).resolves.toEqual([]);
  });
});
