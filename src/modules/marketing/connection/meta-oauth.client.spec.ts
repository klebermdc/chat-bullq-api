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

  it('troca o code por token de longa duracao em dois passos', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'curto' } })
      .mockResolvedValueOnce({ data: { access_token: 'longo', expires_in: 5184000 } });

    const client = new MetaOAuthClient(makeConfig());
    const result = await client.exchangeCodeForLongLivedToken('CODE');

    expect(result.accessToken).toBe('longo');
    expect(result.expiresAt).toBeInstanceOf(Date);

    const [firstUrl, firstCfg] = mockedAxios.get.mock.calls[0];
    expect(firstUrl).toContain('/oauth/access_token');
    expect((firstCfg as any).params).toMatchObject({ client_id: 'app-123', code: 'CODE' });

    const [, secondCfg] = mockedAxios.get.mock.calls[1];
    expect((secondCfg as any).params).toMatchObject({ grant_type: 'fb_exchange_token', fb_exchange_token: 'curto' });
  });

  it('devolve expiresAt nulo quando a Meta nao informa expires_in', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { access_token: 'curto' } })
      .mockResolvedValueOnce({ data: { access_token: 'longo' } });

    const client = new MetaOAuthClient(makeConfig());
    const result = await client.exchangeCodeForLongLivedToken('CODE');

    expect(result.expiresAt).toBeNull();
  });

  it('falha claro quando a Meta nao devolve access_token', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} });
    const client = new MetaOAuthClient(makeConfig());
    await expect(client.exchangeCodeForLongLivedToken('CODE')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falha claro quando as credenciais do app nao estao configuradas', async () => {
    const client = new MetaOAuthClient(makeConfig({ META_ADS_APP_ID: undefined }));
    await expect(client.exchangeCodeForLongLivedToken('CODE')).rejects.toBeInstanceOf(
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
