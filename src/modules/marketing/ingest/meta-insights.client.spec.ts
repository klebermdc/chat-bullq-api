import axios from 'axios';
import { MetaInsightsClient } from './meta-insights.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MetaInsightsClient', () => {
  beforeEach(() => jest.resetAllMocks());

  it('pede nivel de anuncio com quebra diaria', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { data: [] } });

    const client = new MetaInsightsClient();
    await client.fetchAdInsights({
      adAccountId: 'act_1',
      token: 'TOKEN',
      since: '2026-08-01',
      until: '2026-08-07',
    });

    const [url, cfg] = mockedAxios.get.mock.calls[0];
    expect(url).toContain('/act_1/insights');
    expect((cfg as any).params).toMatchObject({
      level: 'ad',
      time_increment: 1,
      access_token: 'TOKEN',
    });
    expect((cfg as any).params.time_range).toBe(
      JSON.stringify({ since: '2026-08-01', until: '2026-08-07' }),
    );
    expect((cfg as any).params.fields).toContain('inline_link_clicks');
    expect((cfg as any).params.fields).toContain('account_currency');
  });

  it('junta todas as paginas', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { data: [{ ad_id: '1' }], paging: { next: 'https://graph.facebook.com/p2' } },
      })
      .mockResolvedValueOnce({
        data: { data: [{ ad_id: '2' }], paging: { next: 'https://graph.facebook.com/p3' } },
      })
      .mockResolvedValueOnce({ data: { data: [{ ad_id: '3' }] } });

    const client = new MetaInsightsClient();
    const rows = await client.fetchAdInsights({
      adAccountId: 'act_1',
      token: 'TOKEN',
      since: '2026-08-01',
      until: '2026-08-07',
    });

    expect(rows.map((r: any) => r.ad_id)).toEqual(['1', '2', '3']);
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });

  it('nao reenvia params na pagina seguinte (o next ja vem completo)', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { data: [], paging: { next: 'https://graph.facebook.com/p2' } } })
      .mockResolvedValueOnce({ data: { data: [] } });

    const client = new MetaInsightsClient();
    await client.fetchAdInsights({ adAccountId: 'act_1', token: 'T', since: '2026-08-01', until: '2026-08-07' });

    expect((mockedAxios.get.mock.calls[1][1] as any).params).toBeUndefined();
  });

  it('devolve lista vazia quando a conta nao gastou no periodo', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { data: [] } });
    const client = new MetaInsightsClient();
    await expect(
      client.fetchAdInsights({ adAccountId: 'act_1', token: 'T', since: '2026-08-01', until: '2026-08-07' }),
    ).resolves.toEqual([]);
  });

  it('propaga o erro da Graph para quem chamou classificar', async () => {
    mockedAxios.get.mockRejectedValueOnce({
      response: { data: { error: { code: 190, error_subcode: 463 } } },
    });
    const client = new MetaInsightsClient();
    await expect(
      client.fetchAdInsights({ adAccountId: 'act_1', token: 'T', since: '2026-08-01', until: '2026-08-07' }),
    ).rejects.toMatchObject({ response: { data: { error: { code: 190 } } } });
  });
});
