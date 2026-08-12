import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GRAPH_API_VERSION, GRAPH_TIMEOUT_MS } from '../marketing.constants';

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
   * O `code` vira um token de 1-2h. O segundo passo (fb_exchange_token) é
   * obrigatório: sem ele o sync morre no mesmo dia.
   */
  async exchangeCodeForLongLivedToken(code: string): Promise<LongLivedToken> {
    const { appId, appSecret } = this.credentials();

    const short = await axios.get(`${this.base()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, code },
      timeout: GRAPH_TIMEOUT_MS,
    });
    const shortToken = short.data?.access_token;
    if (!shortToken) {
      throw new BadRequestException('Meta nao retornou access_token na troca do code');
    }

    const long = await axios.get(`${this.base()}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
      timeout: GRAPH_TIMEOUT_MS,
    });
    const accessToken = long.data?.access_token;
    if (!accessToken) {
      throw new BadRequestException('Meta nao retornou token de longa duracao');
    }

    const expiresIn = Number(long.data?.expires_in);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null;

    return { accessToken, expiresAt };
  }

  /** Todas as contas de anúncio que o token enxerga. */
  async listAdAccounts(token: string): Promise<MetaAdAccount[]> {
    const accounts: MetaAdAccount[] = [];
    let url: string | undefined = `${this.base()}/me/adaccounts`;
    let params: Record<string, unknown> | undefined = {
      fields: 'id,name,currency,timezone_name,business',
      limit: 100,
      access_token: token,
    };

    while (url) {
      const response: { data: any } = await axios.get(url, { params, timeout: GRAPH_TIMEOUT_MS });
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
      url = data?.paging?.next ?? undefined;
      params = undefined;
    }

    return accounts;
  }
}
