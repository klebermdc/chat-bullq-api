import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import axios from 'axios';
import { Channel, ChannelType, OrgRole } from '@prisma/client';
import { WhatsAppPlatformConfigService } from './whatsapp-platform-config.service';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelsRepository } from '../../channels/channels.repository';

@Injectable()
export class WhatsAppEmbeddedSignupService {
  private readonly logger = new Logger(WhatsAppEmbeddedSignupService.name);

  constructor(
    private readonly platform: WhatsAppPlatformConfigService,
    private readonly channelsService: ChannelsService,
    private readonly channelsRepo: ChannelsRepository,
  ) {}

  private base(): string {
    return `https://graph.facebook.com/${this.platform.apiVersion}`;
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const { data } = await axios.get(`${this.base()}/oauth/access_token`, {
      params: { client_id: this.platform.appId, client_secret: this.platform.appSecret, code },
    });
    if (!data?.access_token) {
      throw new BadRequestException('Meta nao retornou access_token na troca do code');
    }
    return data.access_token as string;
  }

  async subscribeWaba(wabaId: string, token: string): Promise<void> {
    await axios.post(
      `${this.base()}/${wabaId}/subscribed_apps`,
      {},
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  /**
   * Registra o número na Cloud API. Sem esse passo o canal RECEBE mas não ENVIA.
   * Ref.: app de exemplo Tech Provider da Meta (fbsamples/business-messaging-sample-tech-provider-app).
   */
  async registerNumber(phoneNumberId: string, token: string): Promise<void> {
    const pin = this.platform.registrationPin;
    if (!pin) {
      throw new BadRequestException('WA_REG_PIN nao configurado — impossivel registrar o numero na Cloud API.');
    }
    await axios.post(
      `${this.base()}/${phoneNumberId}/register`,
      { messaging_product: 'whatsapp', pin },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }

  async getPhoneMetadata(
    phoneNumberId: string,
    token: string,
  ): Promise<{ display_phone_number?: string; verified_name?: string }> {
    const { data } = await axios.get(`${this.base()}/${phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name' },
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  }

  async connect(params: {
    code: string;
    phoneNumberId: string;
    wabaId: string;
    /** Portfólio empresarial dono da WABA — vem no sessionInfo do Embedded Signup. */
    businessId?: string;
    organizationId: string;
    creator?: { userOrganizationId: string; role: OrgRole };
  }): Promise<Channel> {
    let token: string;
    try {
      token = await this.exchangeCodeForToken(params.code);
    } catch (err: any) {
      this.logger.error(`Embedded Signup: falha na troca do code: ${err?.message}`);
      throw new BadRequestException('Falha ao trocar o code por token (code expirado ou app da plataforma mal configurado).');
    }

    try {
      await this.subscribeWaba(params.wabaId, token);
    } catch (err: any) {
      this.logger.error(`Embedded Signup: falha ao inscrever a WABA ${params.wabaId}: ${err?.message}`);
      throw new BadRequestException('Falha ao inscrever a conta (WABA) — verifique a permissao whatsapp_business_management.');
    }

    const existing = (
      await this.channelsRepo.findActiveByTypeAndOrg(
        ChannelType.WHATSAPP_OFFICIAL,
        params.organizationId,
      )
    ).find((c) => (c.config as Record<string, any>)?.phoneNumberId === params.phoneNumberId);

    // O /register tem cota de 10 chamadas por número numa janela móvel de 72h;
    // estourar devolve o erro 133016 e TRAVA o registro por 72 horas. Por isso
    // só registramos uma vez por número: reconectar um canal já registrado
    // (usuário clicando de novo) não pode gastar a cota.
    const alreadyRegistered = Boolean((existing?.config as Record<string, any>)?.registeredAt);
    let registeredAt: string | undefined = (existing?.config as Record<string, any>)?.registeredAt;

    if (alreadyRegistered) {
      this.logger.log(
        `Embedded Signup: numero ${params.phoneNumberId} ja registrado em ${registeredAt} — pulando o /register (cota de 72h).`,
      );
    } else if (!this.platform.registrationPin) {
      this.logger.warn(
        `Embedded Signup: WA_REG_PIN nao configurado — pulando o registro do numero ${params.phoneNumberId}. O envio pode falhar.`,
      );
    } else {
      // Não é fatal: o número pode já estar registrado do lado da Meta (canal
      // recriado, ou coexistência). Abortar jogaria fora uma conexão boa que já
      // recebe mensagens — melhor conectar e gritar no log.
      try {
        await this.registerNumber(params.phoneNumberId, token);
        registeredAt = new Date().toISOString();
      } catch (err: any) {
        this.logger.error(
          `Embedded Signup: falha ao registrar o numero ${params.phoneNumberId} na Cloud API: ${err?.message}. ` +
            'O canal foi conectado, mas o ENVIO pode falhar ate o registro ser refeito.',
        );
      }
    }

    let meta: { display_phone_number?: string; verified_name?: string };
    try {
      meta = await this.getPhoneMetadata(params.phoneNumberId, token);
    } catch (err: any) {
      this.logger.error(`Embedded Signup: falha ao buscar metadados do numero ${params.phoneNumberId}: ${err?.message}`);
      throw new BadRequestException('Falha ao buscar os dados do numero de telefone.');
    }

    const name = meta.verified_name || meta.display_phone_number || 'WhatsApp';
    const config: Record<string, any> = {
      accessToken: token,
      phoneNumberId: params.phoneNumberId,
      businessAccountId: params.wabaId,
      apiVersion: this.platform.apiVersion,
    };
    if (registeredAt) config.registeredAt = registeredAt;
    if (params.businessId) config.businessId = params.businessId;

    if (existing) {
      this.logger.log(`Embedded Signup: atualizando canal existente ${existing.id} (${params.phoneNumberId})`);
      return this.channelsRepo.update(existing.id, {
        name,
        config: { ...(existing.config as Record<string, any>), ...config },
      });
    }

    this.logger.log(`Embedded Signup: criando canal novo para ${params.phoneNumberId}`);
    return this.channelsService.create(
      params.organizationId,
      { type: ChannelType.WHATSAPP_OFFICIAL, name, config },
      params.creator,
    );
  }
}
