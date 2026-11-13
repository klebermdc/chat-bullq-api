import { BadRequestException, Body, Controller, Get, NotFoundException, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CurrentOrg } from '../../common/decorators';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { PrismaService } from '../../database/prisma.service';
import { CallingGraphClient } from './outreach/calling-graph.client';
import { LiveKitDialer } from './outreach/livekit-dialer';
import { parseVoiceCallSettings } from './outreach/outreach.rules';

class UpdateVoiceSettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(168) delayHours?: number;
}

class WhatsappCallingDto {
  @IsString() @Length(1, 64) channelId!: string;
  @IsBoolean() enabled!: boolean;
}

const SIP_HOST_FALLBACK = 'sip.sendtur.com.br';

/** Chave "Ligações da Aline" por agência (desligada por padrão) — só dono e admin. */
@ApiTags('Voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
@Controller('voice/settings')
export class VoiceSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: CallingGraphClient,
    private readonly dialer: LiveKitDialer,
  ) {}

  @Get()
  async get(@CurrentOrg('id') orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    return { ...parseVoiceCallSettings(org?.settings), dialerConfigured: this.dialer.configured };
  }

  @Patch()
  async update(@CurrentOrg('id') orgId: string, @Body() dto: UpdateVoiceSettingsDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const current = (org?.settings && typeof org.settings === 'object' && !Array.isArray(org.settings) ? org.settings : {}) as Record<string, unknown>;
    const next = parseVoiceCallSettings({ voiceCalls: { ...parseVoiceCallSettings(current), ...dto } });
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ...current, voiceCalls: { enabled: next.enabled, delayHours: next.delayHours } } as Prisma.InputJsonValue },
    });
    return { ...next, dialerConfigured: this.dialer.configured };
  }

  /** Liga/desliga o calling + SIP no número da Meta. Ação explícita; nada chama isto sozinho. */
  @Post('whatsapp-calling')
  async whatsappCalling(@CurrentOrg('id') orgId: string, @Body() dto: WhatsappCallingDto) {
    const channel = await this.prisma.channel.findFirst({ where: { id: dto.channelId, organizationId: orgId, deletedAt: null }, select: { type: true, config: true } });
    if (!channel) throw new NotFoundException('Canal não encontrado');
    if (channel.type !== 'WHATSAPP_OFFICIAL') throw new BadRequestException('Ligações só no WhatsApp oficial');
    await this.graph.setCalling(channel, dto.enabled, process.env.VOICE_SIP_HOST?.trim() || SIP_HOST_FALLBACK);
    return { ok: true, enabled: dto.enabled };
  }
}
