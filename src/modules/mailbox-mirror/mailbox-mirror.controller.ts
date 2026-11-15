import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentOrg, CurrentUser, CurrentUserRole, Feature } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { StorageService } from '../storage/storage.service';
import { streamAttachment } from './attachment-stream';
import { MailboxAccessService, Viewer } from './mailbox-access.service';
import { MailboxAdminService } from './mailbox-admin.service';
import { parsePage } from './pagination';

function viewer(organizationId: string, role: OrgRole | undefined, userId: string): Viewer {
  return { organizationId, role, userId };
}

/** E-mails de um cliente, no card do contato. AGENT só vê cliente dele. */
@ApiTags('Mailbox mirror')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('contacts.view')
@Controller('contacts')
export class ContactEmailsController {
  constructor(private readonly access: MailboxAccessService) {}

  @Get(':id/emails')
  @ApiOperation({ summary: 'E-mails da caixa espelhada ligados ao contato (paginado)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(
    @Param('id') contactId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.access.listContactEmails(viewer(orgId, role, userId), contactId, parsePage(page, limit));
  }
}

/** Leitura de um e-mail e dos anexos. Mesma barreira, via contatos ligados. */
@ApiTags('Mailbox mirror')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('contacts.view')
@Controller('emails')
export class EmailsController {
  constructor(
    private readonly access: MailboxAccessService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do e-mail (HTML cru: a web sanitiza antes de mostrar)' })
  findOne(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.access.getEmail(viewer(orgId, role, userId), id);
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Baixa um anexo do e-mail' })
  async attachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.access.attachmentFor(viewer(orgId, role, userId), id, attachmentId);
    await streamAttachment(this.storage, res, file);
  }
}

/** Caixa inteira e status da sincronização: só gestão. */
@ApiTags('Mailbox mirror')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('mailbox.view')
@Controller('mailboxes')
export class MailboxesController {
  constructor(private readonly admin: MailboxAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Caixas espelhadas e status da sincronização' })
  list(@CurrentOrg('id') orgId: string) {
    return this.admin.listMailboxes(orgId);
  }

  @Get(':id/emails')
  @ApiOperation({ summary: 'Todos os e-mails da caixa; ?unlinked=true só os sem cliente' })
  @ApiQuery({ name: 'unlinked', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  emails(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Query('unlinked') unlinked?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listMailboxEmails(orgId, id, unlinked === 'true', parsePage(page, limit));
  }
}
