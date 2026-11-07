import { BadRequestException, Injectable } from '@nestjs/common';
import { ChannelType, WebsiteLeadSettings } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateWebsiteLeadSettingsDto } from './dto/update-website-lead-settings.dto';
import {
  DEFAULT_DELAY_MINUTES,
  DEFAULT_TEMPLATE_NAME,
} from './website-leads.constants';
import {
  generateLeadToken,
  hashLeadToken,
  previewLeadToken,
  webhookPath,
} from './website-lead-token';

const STATS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface WebsiteLeadSettingsView {
  enabled: boolean;
  channelId: string | null;
  templateId: string | null;
  delayMinutes: number;
  hasToken: boolean;
  tokenPreview: string | null;
  tokenCreatedAt: Date | null;
  channels: { id: string; name: string }[];
  templates: {
    id: string;
    channelId: string;
    name: string;
    displayName: string | null;
    status: string;
    category: string;
  }[];
  /** Envios dos últimos 30 dias por situação do retorno (base de custo). */
  stats: Record<string, number>;
}

/**
 * Configuração "Leads do site" (Configurações). Sem linha salva, sugere o
 * canal oficial que tem agente de IA e o template `lead_site_retorno` dele —
 * mas só liga quando alguém salvar com `enabled: true`.
 */
@Injectable()
export class WebsiteLeadSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<WebsiteLeadSettingsView> {
    const [row, channels, templates, stats] = await Promise.all([
      this.prisma.websiteLeadSettings.findUnique({ where: { organizationId } }),
      this.prisma.channel.findMany({
        where: { organizationId, type: ChannelType.WHATSAPP_OFFICIAL, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.messageTemplate.findMany({
        where: { organizationId, channel: { type: ChannelType.WHATSAPP_OFFICIAL } },
        select: { id: true, channelId: true, name: true, displayName: true, status: true, category: true },
        orderBy: { name: 'asc' },
      }),
      this.stats(organizationId),
    ]);

    const channelId = row ? row.channelId : await this.suggestChannel(channels.map((c) => c.id));
    const templateId = row
      ? row.templateId
      : templates.find((t) => t.channelId === channelId && t.name === DEFAULT_TEMPLATE_NAME)?.id ?? null;

    return {
      enabled: row?.enabled ?? false,
      channelId,
      templateId,
      delayMinutes: row?.delayMinutes ?? DEFAULT_DELAY_MINUTES,
      hasToken: !!row?.tokenHash,
      tokenPreview: row?.tokenPreview ?? null,
      tokenCreatedAt: row?.tokenCreatedAt ?? null,
      channels,
      templates,
      stats,
    };
  }

  async update(organizationId: string, dto: UpdateWebsiteLeadSettingsDto): Promise<WebsiteLeadSettingsView> {
    const current = await this.get(organizationId);
    const channelId = dto.channelId !== undefined ? dto.channelId : current.channelId;
    const templateId = dto.templateId !== undefined ? dto.templateId : current.templateId;
    const enabled = dto.enabled ?? current.enabled;

    if (channelId) await this.assertOfficialChannel(organizationId, channelId);
    if (templateId) await this.assertTemplate(organizationId, channelId, templateId);
    if (enabled && (!channelId || !templateId)) {
      throw new BadRequestException('Para ligar, escolha o canal e o template do retorno.');
    }

    const data = {
      enabled,
      channelId,
      templateId,
      delayMinutes: dto.delayMinutes ?? current.delayMinutes,
    };
    await this.prisma.websiteLeadSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    return this.get(organizationId);
  }

  /** Gera (ou troca) o token. O texto puro só existe nesta resposta. */
  async rotateToken(organizationId: string): Promise<{
    token: string;
    tokenPreview: string;
    webhookPath: string;
    webhookPathGuiamento: string;
  }> {
    const token = generateLeadToken();
    const tokenFields = {
      tokenHash: hashLeadToken(token),
      tokenPreview: previewLeadToken(token),
      tokenCreatedAt: new Date(),
    };
    await this.prisma.websiteLeadSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...tokenFields },
      update: tokenFields,
    });
    return {
      token,
      tokenPreview: tokenFields.tokenPreview,
      webhookPath: webhookPath(token),
      webhookPathGuiamento: webhookPath(token, 'guiamento'),
    };
  }

  /** Org dona do token, ou null. Compara pelo hash (o token não é guardado). */
  async findByToken(token: string | null | undefined): Promise<WebsiteLeadSettings | null> {
    if (!token || token.trim().length < 10) return null;
    return this.prisma.websiteLeadSettings.findUnique({
      where: { tokenHash: hashLeadToken(token) },
    });
  }

  private async suggestChannel(officialIds: string[]): Promise<string | null> {
    if (officialIds.length === 0) return null;
    const link = await this.prisma.aiAgentChannel.findFirst({
      where: {
        channelId: { in: officialIds },
        mode: 'AUTONOMOUS',
        agent: { isActive: true, deletedAt: null },
      },
      select: { channelId: true },
    });
    return link?.channelId ?? officialIds[0];
  }

  private async assertOfficialChannel(organizationId: string, channelId: string): Promise<void> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, organizationId, deletedAt: null, type: ChannelType.WHATSAPP_OFFICIAL },
      select: { id: true },
    });
    if (!channel) throw new BadRequestException('Canal inválido: use um WhatsApp oficial desta organização.');
  }

  private async assertTemplate(
    organizationId: string,
    channelId: string | null,
    templateId: string,
  ): Promise<void> {
    const tpl = await this.prisma.messageTemplate.findFirst({
      where: { id: templateId, organizationId },
      select: { channelId: true },
    });
    if (!tpl || tpl.channelId !== channelId) {
      throw new BadRequestException('Template inválido: ele precisa ser do canal escolhido.');
    }
  }

  private async stats(organizationId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.leadSubmission.groupBy({
      by: ['followupStatus'],
      where: { organizationId, createdAt: { gte: new Date(Date.now() - STATS_WINDOW_MS) } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.followupStatus, r._count._all]));
  }
}
