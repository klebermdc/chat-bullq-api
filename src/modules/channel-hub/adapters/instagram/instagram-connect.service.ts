import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelsRepository } from '../../channels/channels.repository';
import { InstagramConnectError } from './instagram-connect.errors';
import { IG_SUBSCRIBED_FIELDS } from './instagram.constants';

/** Nunca logamos segredo inteiro — 12 chars bastam pra distinguir os casos. */
export function redact(secret: string | undefined): string {
  return secret ? `${secret.slice(0, 12)}…` : '-';
}

function metaErrorMessage(err: any): string {
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.error_message ||
    err?.message ||
    'erro desconhecido'
  );
}

@Injectable()
export class InstagramConnectService {
  private readonly logger = new Logger(InstagramConnectService.name);

  constructor(
    private readonly platform: InstagramPlatformConfigService,
    private readonly channelsService: ChannelsService,
    private readonly channelsRepo: ChannelsRepository,
  ) {}

  private graph(): string {
    return `https://graph.instagram.com/${this.platform.apiVersion}`;
  }

  /** Passo 1: code → token curto (vale 1 hora). */
  async exchangeCodeForToken(
    code: string,
  ): Promise<{ accessToken: string; loginUserId: string }> {
    const body = new URLSearchParams({
      client_id: this.platform.appId,
      client_secret: this.platform.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.platform.redirectUri,
      code,
    });

    try {
      const { data } = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        body.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      if (!data?.access_token) {
        throw new InstagramConnectError('code_expirado', 'Meta nao devolveu access_token');
      }
      return {
        accessToken: data.access_token,
        loginUserId: String(data.user_id),
      };
    } catch (err: any) {
      if (err instanceof InstagramConnectError) throw err;
      this.logger.error(
        `troca de code falhou: ${metaErrorMessage(err)} (code=${redact(code)})`,
      );
      // Sem `response` a Meta nem respondeu (timeout, DNS, 5xx sem corpo): o code
      // pode estar perfeitamente válido e mandar o usuário refazer o OAuth seria
      // conselho errado — e esconderia uma indisponibilidade da Meta atrás de um
      // slug que parece culpa do cliente.
      throw new InstagramConnectError(
        err?.response ? 'code_expirado' : 'erro_interno',
        metaErrorMessage(err),
      );
    }
  }

  /** Passo 2: token curto → token de 60 dias. */
  async exchangeForLongLived(
    shortToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const { data } = await axios.get('https://graph.instagram.com/access_token', {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: this.platform.appSecret,
          access_token: shortToken,
        },
      });
      if (!data?.access_token) {
        throw new InstagramConnectError('erro_interno', 'Meta nao devolveu token longo');
      }
      return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5184000 };
    } catch (err: any) {
      if (err instanceof InstagramConnectError) throw err;
      this.logger.error(`troca por token longo falhou: ${metaErrorMessage(err)}`);
      throw new InstagramConnectError('erro_interno', metaErrorMessage(err));
    }
  }

  /**
   * Passo 3: descobre a identidade. O `user_id` DAQUI é o que casa com o
   * `entry.id` do webhook — NÃO é o `user_id` que veio junto com o token curto.
   * Confundir os dois é a origem do "self-healing" que outros projetos precisam
   * fazer no webhook pra adivinhar o dono da mensagem.
   */
  async fetchMe(token: string): Promise<{ igBusinessId: string; username: string }> {
    let data: any;
    try {
      const res = await axios.get(`${this.graph()}/me`, {
        params: { fields: 'user_id,username', access_token: token },
      });
      data = res.data;
    } catch (err: any) {
      this.logger.error(`/me falhou: ${metaErrorMessage(err)}`);
      throw new InstagramConnectError('sem_conta_business', metaErrorMessage(err));
    }

    if (!data?.user_id) {
      throw new InstagramConnectError(
        'sem_conta_business',
        'A conta nao e profissional (o /me nao devolveu user_id).',
      );
    }
    return { igBusinessId: String(data.user_id), username: data.username ?? 'instagram' };
  }

  /** Passo 4: sem isso o canal nasce mudo — recebe zero webhook. */
  async subscribeApp(igBusinessId: string, token: string): Promise<void> {
    try {
      await axios.post(
        `${this.graph()}/${igBusinessId}/subscribed_apps`,
        { subscribed_fields: IG_SUBSCRIBED_FIELDS },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (err: any) {
      this.logger.error(`subscribed_apps falhou: ${metaErrorMessage(err)}`);
      throw new InstagramConnectError('falha_inscricao', metaErrorMessage(err));
    }
  }

  /** Renova o token de 60 dias. Exige token com >=24h de idade e ainda valido. */
  async refreshToken(
    token: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const { data } = await axios.get('https://graph.instagram.com/refresh_access_token', {
        params: { grant_type: 'ig_refresh_token', access_token: token },
      });
      if (!data?.access_token) {
        throw new Error('refresh_access_token nao devolveu token');
      }
      return { accessToken: data.access_token, expiresIn: data.expires_in ?? 5184000 };
    } catch (err: any) {
      // O AxiosError carrega `config.params`, e o token vai NO QUERY STRING —
      // deixar o erro cru subir despejaria uma credencial viva de 60 dias no log.
      // Sobe só a mensagem já extraída.
      throw new Error(metaErrorMessage(err));
    }
  }
}
