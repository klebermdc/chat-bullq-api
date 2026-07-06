import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

/**
 * HTTP client para o WasenderAPI (gateway WhatsApp não-oficial, baseado em
 * sessão/QR — conceitualmente igual ao Zappfy/Uazapi).
 *
 * Há DOIS níveis de credencial:
 *  - Personal Access Token (nível conta) → gerencia sessões: criar, QR,
 *    connect/disconnect, status. Guardado em `config.personalToken`.
 *  - Session API Key (Bearer, gerado ao conectar a sessão) → envia mensagens
 *    e opera sobre a sessão. Guardado em `config.sessionApiKey`.
 *
 * Os nomes de campos do provedor (payloads de send-message / criação de
 * sessão) são propositalmente tolerantes: a doc oficial é enxuta, então
 * lemos várias chaves possíveis nas respostas. Confirmar contra uma conta
 * real na primeira conexão.
 */
@Injectable()
export class WasenderHttpClient {
  private static readonly BASE_URL =
    process.env.WASENDER_BASE_URL || 'https://wasenderapi.com/api';
  private readonly logger = new Logger(WasenderHttpClient.name);

  /** Client autenticado com a Session API Key (envio / operações da sessão). */
  private sessionClient(channel: Channel): AxiosInstance {
    const config = (channel.config ?? {}) as Record<string, any>;
    return axios.create({
      baseURL: WasenderHttpClient.BASE_URL,
      headers: { Authorization: `Bearer ${config.sessionApiKey}` },
      timeout: 30000,
    });
  }

  /** Client autenticado com o Personal Access Token (gestão de sessões). */
  private accountClient(personalToken: string): AxiosInstance {
    return axios.create({
      baseURL: WasenderHttpClient.BASE_URL,
      headers: { Authorization: `Bearer ${personalToken}` },
      timeout: 30000,
    });
  }

  // ─── Envio / operações da sessão (Session API Key) ──────────────────

  async sendRequest(
    channel: Channel,
    endpoint: string,
    payload: Record<string, any>,
  ): Promise<any> {
    const client = this.sessionClient(channel);
    try {
      const response = await client.post(endpoint, payload);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Wasender API error: ${endpoint} - ${error.response?.data?.message || error.message}`,
      );
      throw error;
    }
  }

  /** Status da sessão pela ótica da Session API Key (`GET /status`). */
  async getStatus(channel: Channel): Promise<any> {
    const client = this.sessionClient(channel);
    try {
      const response = await client.get('/status');
      return response.data;
    } catch (error: any) {
      this.logger.error(`Wasender status check failed: ${error.message}`);
      throw error;
    }
  }

  async getMediaBuffer(_channel: Channel, mediaUrl: string): Promise<Buffer> {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  /**
   * Mídia recebida no WhatsApp chega cifrada (URL .enc em mmg.whatsapp.net)
   * que o navegador não consegue tocar. O Wasender expõe `POST /decrypt-media`
   * que decripta server-side e devolve uma URL tocável. Espelha o
   * `resolveInboundMediaUrl` do Zappfy.
   */
  async resolveInboundMediaUrl(
    channel: Channel,
    externalMessageId: string,
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    const response = await this.sendRequest(channel, '/decrypt-media', {
      messageId: externalMessageId,
    });
    const data = response?.data ?? response;
    const fileUrl: string | undefined =
      data?.url || data?.fileUrl || data?.publicUrl || data?.mediaUrl;
    if (!fileUrl) {
      throw new Error(
        `Wasender /decrypt-media returned no url for ${externalMessageId}`,
      );
    }
    return { fileUrl, mimeType: data?.mimetype || data?.mimeType };
  }

  /** Apaga a mensagem pra todos no WhatsApp (`DELETE /messages/{id}`). */
  async deleteMessage(channel: Channel, externalMessageId: string): Promise<void> {
    const client = this.sessionClient(channel);
    try {
      await client.delete(`/messages/${encodeURIComponent(externalMessageId)}`);
    } catch (error: any) {
      this.logger.error(
        `Wasender delete failed: ${error.response?.data?.message || error.message}`,
      );
      throw error;
    }
  }

  async sendPresence(
    channel: Channel,
    to: string,
    presence: 'composing' | 'recording' | 'paused' = 'composing',
  ): Promise<void> {
    await this.sendRequest(channel, '/send-presence-update', { to, presence });
  }

  // ─── Gestão de sessão (Personal Access Token) ───────────────────────

  /**
   * Cria uma sessão WhatsApp no Wasender e (quando `webhookUrl` é passado) já
   * a configura pra apontar o webhook pra nossa API. Devolve o id da sessão,
   * a Session API Key e o webhook secret gerado — tudo persistido no canal.
   */
  async createSession(
    personalToken: string,
    opts: { name: string; webhookUrl?: string; webhookEvents?: string[] },
  ): Promise<{ id: string; apiKey?: string; webhookSecret?: string; raw: any }> {
    const client = this.accountClient(personalToken);
    const payload: Record<string, any> = { name: opts.name };
    if (opts.webhookUrl) {
      payload.webhook_url = opts.webhookUrl;
      payload.webhook_enabled = true;
      payload.webhook_events = opts.webhookEvents ?? [
        'messages.upsert',
        'messages.update',
        'session.status',
      ];
    }
    const response = await client.post('/whatsapp-sessions', payload);
    const data = response.data?.data ?? response.data;
    return {
      id: String(data?.id ?? data?.session_id ?? data?.sessionId),
      apiKey: data?.api_key ?? data?.apiKey,
      webhookSecret: data?.webhook_secret ?? data?.webhookSecret,
      raw: data,
    };
  }

  /** Busca o QR Code atual da sessão (`GET /whatsapp-sessions/{id}/qrcode`). */
  async getQrCode(channel: Channel): Promise<{ qr?: string; raw: any }> {
    const { client, sessionId } = this.accountCtx(channel);
    const response = await client.get(
      `/whatsapp-sessions/${sessionId}/qrcode`,
    );
    const data = response.data?.data ?? response.data;
    const qr: string | undefined =
      data?.qrCode || data?.qr || data?.qrcode || data?.image;
    return { qr, raw: data };
  }

  /** Dispara a conexão da sessão (`POST /whatsapp-sessions/{id}/connect`). */
  async connectSession(channel: Channel): Promise<any> {
    const { client, sessionId } = this.accountCtx(channel);
    const response = await client.post(
      `/whatsapp-sessions/${sessionId}/connect`,
      {},
    );
    return response.data?.data ?? response.data;
  }

  /** Desconecta a sessão (`POST /whatsapp-sessions/{id}/disconnect`). */
  async disconnectSession(channel: Channel): Promise<any> {
    const { client, sessionId } = this.accountCtx(channel);
    const response = await client.post(
      `/whatsapp-sessions/${sessionId}/disconnect`,
      {},
    );
    return response.data?.data ?? response.data;
  }

  /** Detalhes/estado da sessão (`GET /whatsapp-sessions/{id}`). */
  async getSessionDetails(channel: Channel): Promise<any> {
    const { client, sessionId } = this.accountCtx(channel);
    const response = await client.get(`/whatsapp-sessions/${sessionId}`);
    return response.data?.data ?? response.data;
  }

  /** Monta o client de conta + resolve o sessionId a partir do config do canal. */
  private accountCtx(channel: Channel): {
    client: AxiosInstance;
    sessionId: string;
  } {
    const config = (channel.config ?? {}) as Record<string, any>;
    if (!config.personalToken) {
      throw new Error('Canal Wasender sem personalToken no config');
    }
    if (!config.sessionId) {
      throw new Error('Canal Wasender sem sessionId no config');
    }
    return {
      client: this.accountClient(config.personalToken),
      sessionId: String(config.sessionId),
    };
  }
}
