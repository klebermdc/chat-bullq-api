import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { GRAPH_API_VERSION, GRAPH_TIMEOUT_MS } from '../marketing.constants';
import { classifyMetaError } from './meta-error.util';

export interface MetaAdAccount {
  id: string;
  name: string | null;
  currency: string | null;
  timezoneName: string | null;
  businessId: string | null;
}

export interface LongLivedToken {
  accessToken: string;
  expiresAt: Date | null;
}

/** Forma crua de /me/adaccounts. Só o que a gente lê. */
interface RawAdAccount {
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  business?: { id?: string };
}

interface AdAccountsPage {
  data?: RawAdAccount[];
  paging?: { next?: string };
}

/**
 * Fala com o endpoint de OAuth da Graph. Mesmo padrão do
 * WhatsAppEmbeddedSignupService: sem redirect_uri, porque o `code` vem do
 * FB.login do SDK com override_default_response_type.
 */
@Injectable()
export class MetaOAuthClient {
  private readonly logger = new Logger(MetaOAuthClient.name);

  constructor(private readonly config: ConfigService) {}

  private base(): string {
    return `https://graph.facebook.com/${GRAPH_API_VERSION}`;
  }

  private credentials(): { appId: string; appSecret: string } {
    const appId = this.config.get<string>('META_ADS_APP_ID');
    const appSecret = this.config.get<string>('META_ADS_APP_SECRET');
    if (!appId || !appSecret) {
      throw new InternalServerErrorException(
        'META_ADS_APP_ID ou META_ADS_APP_SECRET ausentes — configure o app do Meta Ads.',
      );
    }
    return { appId, appSecret };
  }

  /**
   * Chama a Graph e, quando ela recusa, GRAVA O CORPO DA RESPOSTA no log e
   * devolve a mensagem da Meta para a tela.
   *
   * Sem isto o axios só diz "Request failed with status code 400": o motivo
   * real (code expirado, redirect_uri divergente, permissão faltando) fica
   * invisível, e o operador vê um 500 opaco sem nenhuma pista do que fazer.
   */
  private async graphGet<T>(
    path: string,
    params: Record<string, unknown>,
    etapa: string,
  ): Promise<T> {
    try {
      const { data } = await axios.get(`${this.base()}${path}`, {
        params,
        timeout: GRAPH_TIMEOUT_MS,
      });
      return data as T;
    } catch (err) {
      const body = (err as { response?: { data?: unknown } })?.response?.data;
      const failure = classifyMetaError(err);
      this.logger.error(
        `Meta recusou [${etapa}]: ${failure.message} (code=${failure.code ?? '?'}) body=${JSON.stringify(body ?? {})}`,
      );
      throw new BadRequestException(`Meta recusou (${etapa}): ${failure.message}`);
    }
  }

  /**
   * O `code` vira um token de 1-2h. O segundo passo (fb_exchange_token) é
   * obrigatório: sem ele o sync morre no mesmo dia.
   */
  async exchangeCodeForLongLivedToken(code: string): Promise<LongLivedToken> {
    const { appId, appSecret } = this.credentials();

    // `redirect_uri` VAZIO, e não ausente. O code vem do FB.login do SDK, que
    // não redireciona — e a variação General do Login for Business usa o code
    // OAuth padrão, que exige o parâmetro presente e idêntico ao do diálogo.
    // Omiti-lo devolve "Error validating verification code. Please make sure
    // your redirect_uri is identical...". O Embedded Signup do WhatsApp não
    // precisa disso porque emite um code de Tech Provider, de outro tipo.
    const short = await this.graphGet<{ access_token?: string }>(
      '/oauth/access_token',
      { client_id: appId, client_secret: appSecret, code, redirect_uri: '' },
      'troca do code',
    );
    const shortToken = short?.access_token;
    if (!shortToken) {
      this.logger.warn('Meta nao retornou access_token na troca do code (1a etapa)');
      throw new BadRequestException('Meta nao retornou access_token na troca do code');
    }

    const long = await this.graphGet<{ access_token?: string; expires_in?: number }>(
      '/oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
      'token de longa duracao',
    );
    const accessToken = long?.access_token;
    if (!accessToken) {
      this.logger.warn(
        'Meta nao retornou token de longa duracao (2a etapa, fb_exchange_token)',
      );
      throw new BadRequestException('Meta nao retornou token de longa duracao');
    }

    const expiresIn = Number(long?.expires_in);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null;

    return { accessToken, expiresAt };
  }

  /** Todas as contas de anúncio que o token enxerga. */
  async listAdAccounts(token: string): Promise<MetaAdAccount[]> {
    const accounts: MetaAdAccount[] = [];
    let url: string | null = `${this.base()}/me/adaccounts`;
    let params: Record<string, unknown> | undefined = {
      fields: 'id,name,currency,timezone_name,business',
      limit: 100,
      access_token: token,
    };

    while (url) {
      // A anotação explícita quebra a inferência circular do TS: `url` é
      // reatribuído a partir da própria resposta que ele ajuda a tipar (TS7022).
      const response: AxiosResponse<AdAccountsPage> = await axios.get(url, {
        params,
        timeout: GRAPH_TIMEOUT_MS,
      });
      const data = response.data;
      for (const row of data?.data ?? []) {
        accounts.push({
          id: row.id,
          name: row.name ?? null,
          currency: row.currency ?? null,
          timezoneName: row.timezone_name ?? null,
          businessId: row.business?.id ?? null,
        });
      }
      // O `next` já vem com todos os parâmetros embutidos.
      url = data?.paging?.next ?? null;
      params = undefined;
    }

    return accounts;
  }
}
