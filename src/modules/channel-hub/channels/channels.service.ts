import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  Channel,
  ChannelType,
  ChannelSyncMode,
  ChannelSyncStatus,
  OrgRole,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelsRepository } from './channels.repository';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ChannelAdapterRegistry } from '../channel-adapter.registry';
import { ZappfyHttpClient } from '../adapters/zappfy/zappfy.http-client';
import { WasenderHttpClient } from '../adapters/wasender/wasender.http-client';
import { WhatsAppOfficialHttpClient } from '../adapters/whatsapp-official/whatsapp-official.http-client';
import { InstagramHttpClient } from '../adapters/instagram/instagram.http-client';
import { ChannelSyncOrchestrator } from '../sync/channel-sync.orchestrator';
import {
  ChannelAccessService,
  type ChannelAccess,
} from '../../iam/channel-access/channel-access.service';
import { maskChannelSecrets } from './channel-masking';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly repository: ChannelsRepository,
    private readonly adapterRegistry: ChannelAdapterRegistry,
    private readonly zappfyHttpClient: ZappfyHttpClient,
    private readonly wasenderHttpClient: WasenderHttpClient,
    private readonly waOfficialHttpClient: WhatsAppOfficialHttpClient,
    private readonly instagramHttpClient: InstagramHttpClient,
    private readonly syncOrchestrator: ChannelSyncOrchestrator,
    private readonly prisma: PrismaService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateChannelDto,
    creator?: { userOrganizationId: string; role: OrgRole },
  ) {
    // Wasender: provisiona a sessão ANTES de persistir o canal, pra que o
    // config já nasça com sessionId + sessionApiKey e o webhook aponte pra nós.
    // Se falhar, lança e o canal não é criado (evita canal quebrado).
    if (dto.type === ChannelType.WHATSAPP_WASENDER) {
      await this.provisionWasenderSession(dto);
    }

    let channel = await this.repository.create({
      organizationId,
      type: dto.type,
      name: dto.name,
      config: dto.config,
      webhookSecret: dto.webhookSecret,
      ...(dto.visibility ? { visibility: dto.visibility } : {}),
    });

    // Deny-by-default: a brand new channel has no agents, so AGENT users in the
    // org cannot see it. The creator gets an explicit grant only if they are
    // an AGENT (OWNER/ADMIN bypass via role); admins manage other agents'
    // access via the channel-access endpoints.
    //
    // Pra canal PRIVATE, OWNER/ADMIN também precisa de grant — então se o
    // criador é um deles E o canal é PRIVATE, garantimos o grant pra evitar
    // que o criador se tranque fora do próprio canal recém-criado.
    const needsAgentGrant =
      (creator && creator.role === OrgRole.AGENT) ||
      (creator && dto.visibility === 'PRIVATE');
    if (needsAgentGrant && creator) {
      await this.prisma.channelAgent.create({
        data: {
          channelId: channel.id,
          userOrganizationId: creator.userOrganizationId,
        },
      });
    }

    // Enrich config with provider-side identifiers that the webhook router
    // needs to match incoming events. Without these, the new routing (P0-1)
    // correctly drops webhooks as "unknown locator".
    channel = (await this.enrichProviderIds(channel.id, dto.type)) ?? channel;

    // Zappfy needs its webhook configured on the provider side. Fire-and-forget.
    if (dto.type === ChannelType.WHATSAPP_ZAPPFY) {
      this.configureZappfyWebhook(channel.id).catch((err) =>
        this.logger.warn(`Zappfy webhook config failed: ${err.message}`),
      );
    }

    // WA Official needs the app explicitly subscribed to the WABA before Meta
    // starts delivering webhooks. Fire-and-forget — fails silently when the
    // token lacks `whatsapp_business_management` scope or businessAccountId
    // is missing; the user can retry via PATCH /channels/:id/test.
    if (dto.type === ChannelType.WHATSAPP_OFFICIAL) {
      this.subscribeWaOfficialApp(channel.id).catch((err) =>
        this.logger.warn(
          `WA Official subscribe failed for channel ${channel.id}: ${err.message}`,
        ),
      );
    }

    // Unified sync path — any adapter that registered a HistorySyncPort.
    if (this.adapterRegistry.hasHistorySync(dto.type)) {
      this.syncOrchestrator
        .start(channel.id, { mode: ChannelSyncMode.INITIAL })
        .catch((err) =>
          this.logger.error(
            `Auto-sync enqueue failed for channel ${channel.id}: ${err.message}`,
          ),
        );
    }

    return channel;
  }

  /**
   * Ensures the channel's config contains the provider-side IDs used by the
   * webhook router (`igBusinessId` / `phoneNumberId`). Idempotent: skipped
   * when the IDs are already present. Runs synchronously because the webhook
   * router uses these fields and we'd rather fail channel creation than
   * silently produce an unroutable channel.
   */
  async enrichProviderIds(channelId: string, type: ChannelType) {
    try {
      const channel = await this.repository.findById(channelId);
      if (!channel) return null;
      const config = (channel.config as Record<string, any>) || {};

      if (type === ChannelType.INSTAGRAM && !config.igBusinessId) {
        const info = await this.instagramHttpClient.getMe(channel);
        const id = info?.user_id ?? info?.id;
        if (id) {
          return this.repository.update(channelId, {
            config: { ...config, igBusinessId: String(id) },
          });
        }
      }

      if (type === ChannelType.WHATSAPP_OFFICIAL && !config.phoneNumberId) {
        // phoneNumberId is part of Meta's onboarding output — if the user
        // didn't include it we can't guess, but we log loudly so it isn't silent.
        this.logger.warn(
          `WA Official channel ${channelId} created without config.phoneNumberId — webhooks will be dropped as unknown locator`,
        );
      }

      return channel;
    } catch (err: any) {
      this.logger.warn(
        `enrichProviderIds failed for channel ${channelId}: ${err.message}`,
      );
      return null;
    }
  }

  private async configureZappfyWebhook(channelId: string): Promise<void> {
    const channel = await this.repository.findById(channelId);
    if (!channel) return;
    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      this.logger.warn('APP_URL not set — skipping Zappfy webhook setup');
      return;
    }
    const webhookUrl = `${appUrl}/api/v1/webhooks/WHATSAPP_ZAPPFY`;
    await this.zappfyHttpClient.configureWebhook(channel, webhookUrl);
    this.logger.log(`Zappfy webhook configured: ${webhookUrl}`);
  }

  /**
   * Cria a sessão no Wasender usando o Personal Access Token colado pelo
   * operador e reescreve `dto.config`/`dto.webhookSecret` com os identificadores
   * retornados (sessionId, sessionApiKey, webhookSecret). O webhook já é
   * apontado pra nossa API na criação da sessão (auto-subscribe).
   */
  private async provisionWasenderSession(dto: CreateChannelDto): Promise<void> {
    const config = (dto.config ?? {}) as Record<string, any>;
    // Trim defensivo: colar do painel costuma trazer espaço/quebra-de-linha.
    const trim = (v: any) => (typeof v === 'string' ? v.trim() : v);
    const sessionApiKey = trim(config.sessionApiKey);
    const personalToken = trim(config.personalToken);

    // Fluxo PADRÃO: a sessão já foi criada e CONECTADA no painel do Wasender.
    // O operador cola a "API Access Token" da sessão + o "Webhook Secret" (esse
    // vira o Channel.webhookSecret via dto). Não há nada a provisionar aqui — o
    // webhook é apontado manualmente no painel (mostramos a URL na UI) e o
    // roteamento inbound casa pela assinatura == webhookSecret.
    if (sessionApiKey) {
      dto.config = { sessionApiKey };
      return;
    }

    // Fluxo HÍBRIDO (opcional): cria a sessão via Personal Access Token e
    // aponta o webhook automaticamente. Usado só quando não há sessão pronta.
    if (!personalToken) {
      throw new BadRequestException(
        'Informe a API Access Token da sessão Wasender (ou um Personal Access Token para criar uma nova sessão).',
      );
    }

    const appUrl = process.env.APP_URL;
    const webhookUrl = appUrl
      ? `${appUrl.replace(/\/$/, '')}/api/v1/webhooks/WHATSAPP_WASENDER`
      : undefined;
    if (!webhookUrl) {
      this.logger.warn(
        'APP_URL não configurado — sessão Wasender criada sem webhook automático',
      );
    }

    try {
      const session = await this.wasenderHttpClient.createSession(personalToken, {
        name: dto.name,
        webhookUrl,
      });
      dto.config = {
        personalToken,
        sessionId: session.id,
        ...(session.apiKey ? { sessionApiKey: session.apiKey } : {}),
      };
      if (session.webhookSecret) {
        dto.webhookSecret = session.webhookSecret;
      }
      this.logger.log(`Wasender session provisioned: ${session.id}`);
    } catch (err: any) {
      const detail = err.response?.data?.message || err.message;
      throw new BadRequestException(
        `Falha ao criar a sessão no Wasender: ${detail}`,
      );
    }
  }

  /** Busca o QR Code atual da sessão Wasender do canal. */
  async getWasenderQr(id: string, organizationId: string) {
    const channel = await this.assertWasenderChannel(id, organizationId);
    try {
      const { qr, raw } = await this.wasenderHttpClient.getQrCode(channel);
      return { success: true, qr, data: raw };
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  }

  /** Dispara a conexão da sessão Wasender (mostra QR quando desconectada). */
  async connectWasender(id: string, organizationId: string) {
    const channel = await this.assertWasenderChannel(id, organizationId);
    try {
      const data = await this.wasenderHttpClient.connectSession(channel);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  }

  /** Estado atual da sessão Wasender (connected / connecting / disconnected). */
  async getWasenderStatus(id: string, organizationId: string) {
    const channel = await this.assertWasenderChannel(id, organizationId);
    try {
      const data = await this.wasenderHttpClient.getSessionDetails(channel);
      const status =
        data?.status || data?.state || data?.connectionStatus || 'unknown';
      return { success: true, status, data };
    } catch (err: any) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  }

  private async assertWasenderChannel(id: string, organizationId: string) {
    const channel = await this.findOne(id, organizationId);
    if (channel.type !== ChannelType.WHATSAPP_WASENDER) {
      throw new BadRequestException('Este canal não é do tipo WasenderAPI.');
    }
    return channel;
  }

  private async subscribeWaOfficialApp(channelId: string): Promise<void> {
    const channel = await this.repository.findById(channelId);
    if (!channel) return;
    const config = (channel.config as Record<string, any>) || {};
    if (!config.businessAccountId) {
      this.logger.warn(
        `WA Official channel ${channelId} has no businessAccountId — skipping auto-subscribe (do it manually in Meta dashboard)`,
      );
      return;
    }
    await this.waOfficialHttpClient.subscribeApp(channel);
    this.logger.log(
      `WA Official app subscribed to WABA ${config.businessAccountId} (channel ${channelId})`,
    );
  }

  /**
   * `role` só é passado pelo controller (rota HTTP `GET /channels`) — quando
   * presente, mascara `config`/`webhookSecret` pra quem não é OWNER/ADMIN.
   * Chamadores internos do service (nenhum hoje) que não passem `role`
   * continuam recebendo o canal cru.
   */
  async findAll(organizationId: string, access: ChannelAccess, role?: OrgRole) {
    const accessibleIds = access === 'ALL' ? undefined : [...access];
    const channels = await this.repository.findByOrganization(organizationId, accessibleIds);
    return channels.map((channel) => maskChannelSecrets(channel, role));
  }

  /**
   * `role` é opcional e só deve ser passado pelo controller (rota HTTP
   * `GET /channels/:id`) — presente, mascara `config`/`webhookSecret` pra quem
   * não é OWNER/ADMIN. Chamadores internos do service (sync, test connection,
   * templates, adapters via `enrichProviderIds`/`assertWasenderChannel` etc.)
   * NÃO passam `role` de propósito: precisam do canal cru pra falar com o
   * provedor. Só a resposta HTTP de leitura é mascarada.
   */
  // Sobrecarga: sem `role`, o retorno é o Channel cru (chamadores internos —
  // sync, test connection, adapters, message-templates — seguem tipados
  // corretamente contra o Channel completo). Com `role`, o retorno pode vir
  // mascarado (controller HTTP).
  async findOne(id: string, organizationId: string, access?: ChannelAccess): Promise<Channel>;
  async findOne(
    id: string,
    organizationId: string,
    access: ChannelAccess | undefined,
    role: OrgRole,
  ): Promise<Channel | Omit<Channel, 'config' | 'webhookSecret'>>;
  async findOne(id: string, organizationId: string, access?: ChannelAccess, role?: OrgRole) {
    const channel = await this.repository.findById(id);
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    if (access !== undefined && access !== 'ALL' && !access.has(id)) {
      throw new ForbiddenException('You do not have access to this channel');
    }
    if (role === undefined) return channel;
    return maskChannelSecrets(channel, role);
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateChannelDto,
    callerUserOrganizationId?: string,
  ) {
    await this.findOne(id, organizationId);

    // Visibility é tratado por caminho separado pra garantir auto-grant.
    const { visibility, ...rest } = dto;
    if (visibility && callerUserOrganizationId) {
      await this.channelAccess.setChannelVisibility(
        id,
        organizationId,
        visibility,
        callerUserOrganizationId,
      );
    }

    if (Object.keys(rest).length === 0) {
      return this.repository.findById(id);
    }
    return this.repository.update(id, rest);
  }

  /**
   * Soft-deletes a channel after verifying the caller typed its exact name.
   * Messages and conversations are preserved — they are flagged `deletedAt`
   * so they stop showing in UI without destroying history.
   */
  async remove(id: string, organizationId: string, confirmName?: string) {
    const channel = await this.findOne(id, organizationId);
    if (!confirmName || confirmName.trim() !== channel.name) {
      throw new BadRequestException(
        'Confirme digitando exatamente o nome do canal para remover.',
      );
    }
    return this.repository.softDelete(id);
  }

  async findActiveByType(type: ChannelType) {
    return this.repository.findActiveByType(type);
  }

  /**
   * Resolve the channel that owns a given webhook payload by asking the
   * inbound adapter to match against `config`. Returns null when no channel
   * matches — caller MUST drop the event (and ideally log for investigation).
   */
  async resolveByLocator(
    type: ChannelType,
    matches: (channel: { config: any }) => boolean,
  ) {
    const candidates = await this.repository.findActiveByType(type);
    return candidates.find((c) => matches(c)) ?? null;
  }

  async syncChannel(id: string, organizationId: string) {
    const channel = await this.findOne(id, organizationId);

    if (!this.adapterRegistry.hasHistorySync(channel.type)) {
      return {
        success: false,
        error: `Sync not supported for channel type ${channel.type}`,
      };
    }

    const job = await this.syncOrchestrator.start(channel.id, {
      mode: ChannelSyncMode.MANUAL,
    });
    return { success: true, jobId: job.id, status: job.status };
  }

  async getSyncStatus(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    const job = await this.prisma.channelSyncJob.findFirst({
      where: { channelId: id },
      orderBy: { createdAt: 'desc' },
    });
    return { job };
  }

  async cancelSync(id: string, organizationId: string) {
    const channel = await this.findOne(id, organizationId);

    if (this.adapterRegistry.hasHistorySync(channel.type)) {
      const job = await this.syncOrchestrator.cancel(id);
      return { job };
    }

    const active = await this.prisma.channelSyncJob.findFirst({
      where: {
        channelId: id,
        status: { in: [ChannelSyncStatus.PENDING, ChannelSyncStatus.RUNNING] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) return { job: null };

    const job = await this.prisma.channelSyncJob.update({
      where: { id: active.id },
      data: { status: ChannelSyncStatus.CANCELLED, finishedAt: new Date() },
    });
    return { job };
  }

  async testConnection(id: string, organizationId: string) {
    const channel = await this.findOne(id, organizationId);

    try {
      switch (channel.type) {
        case ChannelType.WHATSAPP_ZAPPFY: {
          const status = await this.zappfyHttpClient.getInstanceStatus(channel);
          const rawState = status?.state;
          const statusStr =
            typeof rawState === 'string'
              ? rawState
              : typeof rawState === 'object' && rawState?.status
                ? String(rawState.status)
                : typeof status?.status === 'string'
                  ? status.status
                  : 'connected';
          return {
            success: true,
            status: statusStr,
            data: status,
          };
        }

        case ChannelType.WHATSAPP_WASENDER: {
          // Usa a Session API Key (GET /status) — funciona no fluxo padrão,
          // onde não há Personal Access Token nem sessionId no config.
          const st = await this.wasenderHttpClient.getStatus(channel);
          const data = st?.data ?? st;
          const status =
            data?.status || data?.state || data?.connectionStatus || 'connected';
          return { success: true, status: String(status), data: st };
        }

        case ChannelType.WHATSAPP_OFFICIAL: {
          const info = await this.waOfficialHttpClient.verifyPhoneNumber(channel);
          return {
            success: true,
            status: 'connected',
            data: {
              phoneNumber: info.display_phone_number,
              qualityRating: info.quality_rating,
              verifiedName: info.verified_name,
            },
          };
        }

        case ChannelType.INSTAGRAM: {
          const info = await this.instagramHttpClient.getMe(channel);
          return {
            success: true,
            status: 'connected',
            data: {
              username: info.username,
              igUserId: info.user_id || info.id,
              accountType: info.account_type,
              name: info.name,
            },
          };
        }

        default:
          return { success: false, error: 'Unsupported channel type' };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }
}
