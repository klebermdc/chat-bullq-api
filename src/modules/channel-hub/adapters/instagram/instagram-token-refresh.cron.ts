import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, NotificationType } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { ChannelsRepository } from '../../channels/channels.repository';
import { NotificationsService } from '../../../notifications/notifications.service';
import { InstagramConnectService } from './instagram-connect.service';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';
import { IG_OAUTH_REDIS } from './instagram-oauth-state.service';
import { IG_TOKEN_REFRESH_QUEUE, IG_TOKEN_REFRESH_JOB } from './instagram.constants';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Um alerta por canal por dia. Canal quebrado nao pode virar 60 notificacoes. */
const THROTTLE_ALERTA_SEGUNDOS = 24 * 60 * 60;

/**
 * O token do Instagram vale 60 dias e, se ficar 60 dias sem uso nem renovacao,
 * expira em DEFINITIVO — nao da pra renovar depois, so reconectando na mao.
 * Por isso a varredura e proativa e cobre todas as orgs, sem opt-in.
 *
 * Mesmo padrao do InactivityWatchdogCron: registra o job repeat no boot e
 * processa a varredura no worker.
 */
@Processor(IG_TOKEN_REFRESH_QUEUE, { concurrency: 1 })
export class InstagramTokenRefreshCron extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(InstagramTokenRefreshCron.name);
  private readonly pattern = process.env.IG_TOKEN_REFRESH_CRON ?? '0 4 * * *';

  constructor(
    @InjectQueue(IG_TOKEN_REFRESH_QUEUE) private readonly queue: Queue,
    private readonly channelsRepo: ChannelsRepository,
    private readonly connect: InstagramConnectService,
    private readonly notifications: NotificationsService,
    private readonly platform: InstagramPlatformConfigService,
    @Inject(IG_OAUTH_REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        IG_TOKEN_REFRESH_JOB,
        {},
        {
          repeat: { pattern: this.pattern },
          jobId: 'instagram-token-refresh-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
      this.logger.log(`instagram_token_refresh_registered pattern=${this.pattern}`);
    } catch (err) {
      this.logger.error(
        `Falha registrando o cron de refresh do Instagram: ${(err as Error).message}`,
      );
    }
  }

  async process(
    _job: Job,
  ): Promise<{ verificados: number; renovados: number; falhas: number }> {
    const canais = await this.channelsRepo.findActiveByType(ChannelType.INSTAGRAM);
    const limiteMs = this.platform.refreshThresholdDays * DIA_MS;
    let renovados = 0;
    let falhas = 0;

    for (const canal of canais) {
      const config = (canal.config ?? {}) as Record<string, any>;
      if (!config.tokenExpiresAt || !config.accessToken) continue;

      const restaMs = new Date(config.tokenExpiresAt).getTime() - Date.now();
      if (restaMs > limiteMs) continue;

      try {
        const novo = await this.connect.refreshToken(config.accessToken);
        await this.channelsRepo.update(canal.id, {
          config: {
            ...config,
            accessToken: novo.accessToken,
            tokenExpiresAt: new Date(Date.now() + novo.expiresIn * 1000).toISOString(),
            tokenRefreshedAt: new Date().toISOString(),
            refreshFailures: 0,
            lastRefreshError: null,
          },
        });
        renovados++;
        this.logger.log(`instagram_token_refreshed channel=${canal.id}`);
      } catch (err) {
        falhas++;
        const mensagem = (err as Error).message;
        const tentativas = Number(config.refreshFailures ?? 0) + 1;

        // O canal SEGUE ATIVO de proposito. Desativar faria o webhook descartar
        // inbound em silencio — trocariamos "nao consigo responder" por "nao
        // recebo nada e ninguem sabe", que foi o apagao do Comercial.
        await this.channelsRepo.update(canal.id, {
          config: { ...config, refreshFailures: tentativas, lastRefreshError: mensagem },
        });

        this.logger.error(
          `instagram_token_refresh_failed channel=${canal.id} tentativa=${tentativas}: ${mensagem}`,
        );
        await this.alertar(canal, restaMs, mensagem);
      }
    }

    return { verificados: canais.length, renovados, falhas };
  }

  private async alertar(
    canal: { id: string; organizationId: string; name: string },
    restaMs: number,
    mensagem: string,
  ): Promise<void> {
    const podeAlertar = await this.redis.set(
      `ig:token-alert:${canal.id}`,
      '1',
      'EX',
      THROTTLE_ALERTA_SEGUNDOS,
      'NX',
    );
    if (podeAlertar !== 'OK') return;

    const dias = Math.max(0, Math.floor(restaMs / DIA_MS));
    await this.notifications.notifyOrgAgents({
      organizationId: canal.organizationId,
      type: NotificationType.SYSTEM,
      title: `Instagram "${canal.name}": renovacao automatica falhou`,
      body:
        dias > 0
          ? `A conexao vence em ${dias} dia(s) e a renovacao automatica falhou. Reconecte em Configuracoes → Canais.`
          : 'A conexao venceu e a renovacao automatica falhou. Reconecte em Configuracoes → Canais.',
      data: { channelId: canal.id, erro: mensagem },
    });
  }
}
