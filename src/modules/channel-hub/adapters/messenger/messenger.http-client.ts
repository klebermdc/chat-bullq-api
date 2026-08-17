import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

interface MessengerConfig {
  accessToken: string;
  pageId?: string;
  appSecret?: string;
  apiVersion: string;
}

export interface MessengerUserProfile {
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}

export interface MessengerPageInfo {
  id: string;
  name?: string;
  category?: string;
}

@Injectable()
export class MessengerHttpClient {
  private readonly logger = new Logger(MessengerHttpClient.name);

  private getConfig(channel: Channel): MessengerConfig {
    const config = (channel.config ?? {}) as Record<string, any>;
    return {
      accessToken: config.accessToken || config.pageAccessToken,
      pageId: config.pageId,
      appSecret: config.appSecret,
      apiVersion: config.apiVersion || 'v21.0',
    };
  }

  private createClient(channel: Channel): AxiosInstance {
    const cfg = this.getConfig(channel);
    return axios.create({
      // Messenger usa graph.facebook.com (o Instagram usa graph.instagram.com).
      baseURL: `https://graph.facebook.com/${cfg.apiVersion}`,
      params: { access_token: cfg.accessToken },
      timeout: 30000,
    });
  }

  async sendMessage(channel: Channel, payload: Record<string, any>): Promise<any> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.post('/me/messages', payload);
      return data;
    } catch (err: unknown) {
      throw this.wrapGraphError(err, 'sendMessage');
    }
  }

  /**
   * Dados da Página dona do token. Serve ao "Testar conexão" da tela de canais:
   * se o Page Access Token estiver vencido ou for de outra Página, isto falha
   * com o motivo real da Meta em vez de o atendente descobrir só quando uma
   * mensagem não sair.
   *
   * Diferente do `getUserProfile`, NÃO engole o erro — quem chama precisa
   * distinguir "conectado" de "token quebrado".
   */
  async getPage(channel: Channel): Promise<MessengerPageInfo> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.get('/me', {
        params: { fields: 'id,name,category' },
      });
      return data;
    } catch (err: unknown) {
      throw this.wrapGraphError(err, 'getPage');
    }
  }

  async getUserProfile(
    channel: Channel,
    psid: string,
  ): Promise<MessengerUserProfile | null> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.get(`/${psid}`, {
        params: { fields: 'first_name,last_name,profile_pic' },
      });
      return data;
    } catch (err: unknown) {
      this.logger.warn(`getUserProfile falhou para ${psid}: ${this.describe(err)}`);
      return null;
    }
  }

  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    const { data } = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    return Buffer.from(data);
  }

  /**
   * A Meta devolve o motivo real em `error.message`; sem isso o erro chega no
   * `failedReason` como "Request failed with status code 400" e o atendente
   * fica sem saber o que aconteceu.
   */
  private wrapGraphError(err: unknown, operation: string): Error {
    const response = (err as { response?: { data?: { error?: Record<string, any> } } })?.response;
    const metaError = response?.data?.error;
    if (metaError) {
      return new Error(
        `Messenger ${operation} falhou: ${metaError.message} ` +
          `(code=${metaError.code ?? 'n/a'}, subcode=${metaError.error_subcode ?? 'n/a'})`,
      );
    }
    return new Error(`Messenger ${operation} falhou: ${this.describe(err)}`);
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
