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

    let meta: { display_phone_number?: string; verified_name?: string };
    try {
      meta = await this.getPhoneMetadata(params.phoneNumberId, token);
    } catch (err: any) {
      this.logger.error(`Embedded Signup: falha ao buscar metadados do numero ${params.phoneNumberId}: ${err?.message}`);
      throw new BadRequestException('Falha ao buscar os dados do numero de telefone.');
    }

    const name = meta.verified_name || meta.display_phone_number || 'WhatsApp';
    const config = {
      accessToken: token,
      phoneNumberId: params.phoneNumberId,
      businessAccountId: params.wabaId,
      apiVersion: this.platform.apiVersion,
    };

    const existing = (
      await this.channelsRepo.findActiveByTypeAndOrg(
        ChannelType.WHATSAPP_OFFICIAL,
        params.organizationId,
      )
    ).find((c) => (c.config as Record<string, any>)?.phoneNumberId === params.phoneNumberId);

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
