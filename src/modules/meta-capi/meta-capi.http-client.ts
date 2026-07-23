import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const GRAPH_API_VERSION = 'v21.0';

export interface CapiSendResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Cliente HTTP da Conversions API (Graph). Mesmo host do Cloud API
 * (graph.facebook.com), mas endpoint /{datasetId}/events.
 */
@Injectable()
export class MetaCapiHttpClient {
  private readonly logger = new Logger(MetaCapiHttpClient.name);

  async sendEvents(params: {
    datasetId: string;
    token: string;
    data: Record<string, any>[];
    testEventCode?: string | null;
  }): Promise<CapiSendResult> {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.datasetId}/events`;
    const payload: Record<string, any> = {
      data: params.data,
      access_token: params.token,
    };
    if (params.testEventCode) payload.test_event_code = params.testEventCode;

    try {
      const res = await axios.post(url, payload, { timeout: 30000 });
      return { ok: true, status: res.status, body: res.data };
    } catch (err: any) {
      const status = err?.response?.status ?? 0;
      const body = err?.response?.data ?? { message: err?.message };
      this.logger.warn(
        `CAPI send failed (dataset=${params.datasetId}) status=${status}: ${JSON.stringify(body)}`,
      );
      return { ok: false, status, body };
    }
  }
}
