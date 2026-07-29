import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import {
  CurrentChannelAccess,
  CurrentOrg,
  CurrentUserRole,
  Roles,
  Public,
} from '../../../common/decorators';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';
import { WhatsAppEmbeddedSignupService } from '../adapters/whatsapp-official/whatsapp-embedded-signup.service';
import { EmbeddedSignupDto } from './dto/embedded-signup.dto';
import { InstagramConnectService } from '../adapters/instagram/instagram-connect.service';
import { InstagramOAuthStateService } from '../adapters/instagram/instagram-oauth-state.service';
import { InstagramPlatformConfigService } from '../adapters/instagram/instagram-platform-config.service';
import { InstagramConnectError } from '../adapters/instagram/instagram-connect.errors';
import { IG_OAUTH_SCOPES } from '../adapters/instagram/instagram.constants';
import {
  InstagramAuthorizeQueryDto,
  InstagramCallbackQueryDto,
} from './dto/instagram-connect.dto';

@ApiTags('Channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly service: ChannelsService,
    private readonly embeddedSignup: WhatsAppEmbeddedSignupService,
    private readonly igConnect: InstagramConnectService,
    private readonly igState: InstagramOAuthStateService,
    private readonly igPlatform: InstagramPlatformConfigService,
  ) {}

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'Create a new channel. Restricted to OWNER/ADMIN.',
  })
  create(
    @CurrentOrg() org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Body() dto: CreateChannelDto,
  ) {
    return this.service.create(org.id, dto, {
      userOrganizationId: org.userOrganizationId,
      role: org.userRole,
    });
  }

  @Post('whatsapp/embedded-signup')
  @ApiOperation({ summary: 'Conecta um WhatsApp via Embedded Signup (popup Meta) e cria o canal.' })
  connectWhatsApp(
    @CurrentOrg() org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Body() dto: EmbeddedSignupDto,
  ) {
    return this.embeddedSignup.connect({
      code: dto.code,
      phoneNumberId: dto.phoneNumberId,
      wabaId: dto.wabaId,
      businessId: dto.businessId,
      organizationId: org.id,
      creator: { userOrganizationId: org.userOrganizationId, role: org.userRole },
    });
  }

  @Get()
  @ApiOperation({ summary: 'List all channels for the organization' })
  findAll(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.findAll(orgId, access, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get channel by ID' })
  findOne(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.findOne(id, orgId, access, role);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Update a channel' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentOrg('userOrganizationId') userOrganizationId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.service.update(id, orgId, dto, userOrganizationId);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'Soft-delete a channel. Requires ?confirmName=<exact channel name>.',
  })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Query('confirmName') confirmName?: string,
  ) {
    return this.service.remove(id, orgId, confirmName);
  }

  @Post(':id/sync')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Sync channel — import chats, contacts, and messages from provider' })
  syncChannel(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.syncChannel(id, orgId);
  }

  @Get(':id/sync/status')
  @ApiOperation({ summary: 'Get latest sync job status for a channel' })
  getSyncStatus(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.getSyncStatus(id, orgId);
  }

  @Post(':id/sync/cancel')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cancel active sync for a channel' })
  cancelSync(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.cancelSync(id, orgId);
  }

  @Post(':id/test')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Test channel connection' })
  testConnection(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.testConnection(id, orgId);
  }

  @Get('instagram/authorize')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Devolve a URL de autorizacao do Instagram com o state assinado.' })
  instagramAuthorize(
    @CurrentOrg() org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Query() query: InstagramAuthorizeQueryDto,
  ): { url: string } {
    if (!this.igPlatform.isConfigured) {
      throw new BadRequestException(
        'Instagram nao configurado no servidor (faltam IG_APP_ID / IG_APP_SECRET / IG_REDIRECT_URI / IG_STATE_SECRET).',
      );
    }

    const returnTo = query.returnTo;
    if (!returnTo) {
      throw new BadRequestException('returnTo e obrigatorio');
    }

    const state = this.igState.sign({
      organizationId: org.id,
      userOrganizationId: org.userOrganizationId,
      role: org.userRole,
      returnTo,
    });

    const params = new URLSearchParams({
      enable_fb_login: '0',
      force_authentication: '1',
      client_id: this.igPlatform.appId,
      redirect_uri: this.igPlatform.redirectUri,
      response_type: 'code',
      scope: IG_OAUTH_SCOPES,
      state,
    });

    return { url: `https://www.instagram.com/oauth/authorize?${params.toString()}` };
  }

  @Get('instagram/callback')
  @Public()
  @ApiOperation({ summary: 'Callback do OAuth do Instagram. Chamado pela Meta, sem JWT.' })
  async instagramCallback(
    @Query() query: InstagramCallbackQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    // A Meta manda `error` quando o usuário cancela na tela dela. Sem state
    // válido não dá pra saber pra onde voltar, então caímos no fallback.
    const fallback = this.igPlatform.returnAllowlist[0]
      ? `https://${this.igPlatform.returnAllowlist[0]}/settings/channels`
      : '/';

    // `base` já passou pelo allowlist em `verify()` (ou é o fallback fixo do
    // servidor), mas pode conter query string própria — concatenar `?ig=...`
    // na unha quebraria a URL com um `?` duplicado. `URL` evita isso e escapa
    // os valores automaticamente.
    const redirectWith = (base: string, params: Record<string, string>): string => {
      try {
        const url = new URL(base);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        return url.toString();
      } catch {
        return base;
      }
    };

    let payload;
    try {
      payload = await this.igState.verify(query.state ?? '');
    } catch {
      res.redirect(redirectWith(fallback, { ig: 'erro', motivo: 'state_invalido' }));
      return;
    }

    if (query.error || !query.code) {
      res.redirect(redirectWith(payload.returnTo, { ig: 'erro', motivo: 'permissao_negada' }));
      return;
    }

    try {
      const channel = await this.igConnect.connect({
        code: query.code,
        organizationId: payload.organizationId,
        userOrganizationId: payload.userOrganizationId,
        role: payload.role,
      });
      res.redirect(redirectWith(payload.returnTo, { ig: 'ok', channel: channel.id }));
    } catch (err: any) {
      const motivo = err instanceof InstagramConnectError ? err.slug : 'erro_interno';
      res.redirect(redirectWith(payload.returnTo, { ig: 'erro', motivo }));
    }
  }
}
