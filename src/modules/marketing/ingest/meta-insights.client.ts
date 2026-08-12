import { Injectable } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import {
  GRAPH_API_VERSION,
  GRAPH_TIMEOUT_MS,
  INSIGHTS_PAGE_LIMIT,
} from '../marketing.constants';

const INSIGHT_FIELDS = [
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'account_currency',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'inline_link_clicks',
  'frequency',
  'ctr',
  'cpc',
  'actions',
].join(',');

interface InsightsPage {
  data?: any[];
  paging?: { next?: string };
}

export interface FetchInsightsParams {
  adAccountId: string;
  token: string;
  /** YYYY-MM-DD */
  since: string;
  /** YYYY-MM-DD */
  until: string;
}

/**
 * Lê /{act_id}/insights no nível de anúncio, um registro por dia.
 * Não trata erro: quem chama usa `classifyMetaError` para decidir se é
 * credencial morta, limite de requisição ou falha passageira.
 */
@Injectable()
export class MetaInsightsClient {
  async fetchAdInsights(params: FetchInsightsParams): Promise<any[]> {
    const rows: any[] = [];
    let url: string | null =
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.adAccountId}/insights`;
    let query: Record<string, unknown> | undefined = {
      level: 'ad',
      time_increment: 1,
      time_range: JSON.stringify({ since: params.since, until: params.until }),
      fields: INSIGHT_FIELDS,
      limit: INSIGHTS_PAGE_LIMIT,
      access_token: params.token,
    };

    while (url) {
      // Anotação explícita evita a inferência circular do TS (TS7022): `url` é
      // reatribuído a partir da própria resposta que ele ajuda a tipar.
      const response: AxiosResponse<InsightsPage> = await axios.get(url, {
        params: query,
        timeout: GRAPH_TIMEOUT_MS,
      });
      const data = response.data;
      rows.push(...(data?.data ?? []));
      url = data?.paging?.next ?? null;
      query = undefined;
    }

    return rows;
  }
}
