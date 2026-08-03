import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';
import { GraphCreatePayload } from '../../message-templates/template-components.types';

interface WaOfficialConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  apiVersion?: string;
}

@Injectable()
export class WhatsAppOfficialHttpClient {
  private readonly logger = new Logger(WhatsAppOfficialHttpClient.name);

  private getConfig(channel: Channel): WaOfficialConfig {
    const config = channel.config as Record<string, any>;
    return {
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      apiVersion: config.apiVersion || 'v21.0',
    };
  }

  private createClient(channel: Channel): AxiosInstance {
    const cfg = this.getConfig(channel);
    return axios.create({
      baseURL: `https://graph.facebook.com/${cfg.apiVersion}`,
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      timeout: 30000,
    });
  }

  /**
   * Traduz um erro da Graph API num BadRequestException legível.
   *
   * A Meta responde erros em `error.response.data.error`, com os campos
   * amigáveis `error_user_title`/`error_user_msg` (o motivo real que o
   * usuário precisa ver) além do `message` genérico ("Invalid parameter").
   * Antes esse erro cru era re-lançado e o NestJS devolvia 500 "Internal
   * server error", escondendo o motivo. Aqui logamos o objeto completo (para
   * diagnóstico) e devolvemos uma mensagem que chega ao toast do front.
   */
  private metaError(context: string, error: any): BadRequestException {
    const meta = error?.response?.data?.error;
    if (meta) {
      this.logger.error(
        `${context} — resposta da Meta: ${JSON.stringify(meta)}`,
      );
    } else {
      this.logger.error(`${context}: ${error?.message}`);
    }
    const detail =
      [meta?.error_user_title, meta?.error_user_msg]
        .filter(Boolean)
        .join(' — ') ||
      meta?.message ||
      error?.message ||
      'erro desconhecido';
    return new BadRequestException(`Meta recusou a operação: ${detail}`);
  }

  async sendMessage(
    channel: Channel,
    payload: Record<string, any>,
  ): Promise<any> {
    const cfg = this.getConfig(channel);
    const client = this.createClient(channel);
    try {
      const { data } = await client.post(
        `/${cfg.phoneNumberId}/messages`,
        payload,
      );
      return data;
    } catch (error: any) {
      throw this.metaSendError(error);
    }
  }

  /**
   * Enriquece um erro de ENVIO com o motivo real da Meta, preservando o
   * shape do axios.
   *
   * Diferente dos outros métodos daqui, envio NÃO pode virar
   * `BadRequestException`: o `isRetryableSendError` do
   * OutboundMessageProcessor decide retry lendo `error.response.status`, e
   * achatar tudo em 400 mataria o backoff do BullMQ em 429/5xx — a mensagem
   * morreria FAILED no primeiro rate-limit. Então mantemos `response`,
   * `status` e `code` e só reescrevemos a `.message`.
   *
   * Isso importa porque o envio é assíncrono (fila): o front já respondeu
   * "Template enviado" antes da Meta recusar. O ÚNICO lugar onde o
   * atendente vê o motivo é o `failedReason`, que o processor grava a
   * partir justamente desta `.message`. Antes daqui ela era o texto do
   * axios ("Request failed with status code 400") e o motivo real só
   * existia no log do container.
   */
  private metaSendError(error: any): any {
    const meta = error?.response?.data?.error;
    if (!meta) {
      this.logger.error(`WA Official API error: ${error?.message}`);
      return error;
    }

    this.logger.error(
      `WA Official API error — resposta da Meta: ${JSON.stringify(meta)}`,
    );

    // `error_data.details` é o campo mais preciso em falha de template — é
    // ele que diz QUAL template/idioma não existe. Depois vêm os campos
    // amigáveis, e por último a `message` genérica ("Invalid parameter").
    const detail =
      meta.error_data?.details ||
      [meta.error_user_title, meta.error_user_msg].filter(Boolean).join(' — ') ||
      meta.message ||
      'erro desconhecido';
    const code = meta.code ? ` (${meta.code})` : '';

    const enriched: any = new Error(`Meta recusou o envio${code}: ${detail}`);
    // Preserva o que o retry e o diagnóstico downstream leem.
    enriched.response = error.response;
    enriched.status = error.status ?? error.response?.status;
    enriched.code = error.code;
    enriched.isAxiosError = error.isAxiosError;
    enriched.cause = error;
    return enriched;
  }

  async getMediaUrl(channel: Channel, mediaId: string): Promise<string> {
    const client = this.createClient(channel);
    const { data } = await client.get(`/${mediaId}`);
    return data.url;
  }

  async downloadMedia(channel: Channel, url: string): Promise<Buffer> {
    const cfg = this.getConfig(channel);
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  async verifyPhoneNumber(channel: Channel): Promise<any> {
    const cfg = this.getConfig(channel);
    const client = this.createClient(channel);
    try {
      const { data } = await client.get(`/${cfg.phoneNumberId}`);
      return data;
    } catch (error: any) {
      this.logger.error(`WA Official verify failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Subscribes our app to receive webhooks for this WABA. Idempotent on
   * Meta's side — re-calling is safe. Requires `whatsapp_business_management`
   * scope on the access token.
   */
  async subscribeApp(channel: Channel): Promise<any> {
    const cfg = this.getConfig(channel);
    if (!cfg.businessAccountId) {
      throw new Error('businessAccountId required to subscribe app');
    }
    const client = this.createClient(channel);
    const { data } = await client.post(`/${cfg.businessAccountId}/subscribed_apps`);
    return data;
  }

  async createTemplate(
    channel: Channel,
    payload: GraphCreatePayload,
  ): Promise<{ id: string; status: string; category: string }> {
    const cfg = this.getConfig(channel);
    if (!cfg.businessAccountId) {
      throw new Error('businessAccountId required to create template');
    }
    const client = this.createClient(channel);
    try {
      const { data } = await client.post(
        `/${cfg.businessAccountId}/message_templates`,
        payload,
      );
      return { id: data.id, status: data.status, category: data.category };
    } catch (error: any) {
      throw this.metaError('WA Official create template failed', error);
    }
  }

  async listTemplates(channel: Channel): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
      category: string;
      language: string;
      components: unknown[];
    }>
  > {
    const cfg = this.getConfig(channel);
    if (!cfg.businessAccountId) {
      throw new Error('businessAccountId required to list templates');
    }
    const client = this.createClient(channel);
    try {
      const { data } = await client.get(
        `/${cfg.businessAccountId}/message_templates?fields=id,name,status,category,language,components&limit=200`,
      );
      return data.data ?? [];
    } catch (error: any) {
      throw this.metaError('WA Official list templates failed', error);
    }
  }

  async uploadHeaderSample(
    channel: Channel,
    file: { buffer: Buffer; fileName: string; mimeType: string },
  ): Promise<string> {
    const cfg = this.getConfig(channel);
    const appId = (channel.config as any)?.appId;
    if (!appId) {
      throw new BadRequestException(
        'Canal sem appId (necessário para upload de mídia de template)',
      );
    }
    const base = `https://graph.facebook.com/${cfg.apiVersion}`;
    try {
      const start = await axios.post(`${base}/${appId}/uploads`, null, {
        params: {
          file_name: file.fileName,
          file_length: file.buffer.length,
          file_type: file.mimeType,
        },
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      });
      const uploadId = start.data.id;
      const fin = await axios.post(`${base}/${uploadId}`, file.buffer, {
        headers: {
          Authorization: `OAuth ${cfg.accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return fin.data.h;
    } catch (error: any) {
      throw this.metaError('WA Official upload header sample failed', error);
    }
  }

  async deleteTemplate(
    channel: Channel,
    name: string,
    metaTemplateId?: string,
  ): Promise<void> {
    const cfg = this.getConfig(channel);
    if (!cfg.businessAccountId) {
      throw new Error('businessAccountId required to delete template');
    }
    const client = this.createClient(channel);
    let url = `/${cfg.businessAccountId}/message_templates?name=${encodeURIComponent(name)}`;
    if (metaTemplateId) {
      url += `&hsm_id=${metaTemplateId}`;
    }
    try {
      await client.delete(url);
    } catch (error: any) {
      throw this.metaError('WA Official delete template failed', error);
    }
  }
}
