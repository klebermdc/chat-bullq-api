import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { PrismaService } from '../../../database/prisma.service';
import { InactivitySettingsService } from './inactivity-settings.service';
import { ReengageDraftService } from './reengage-draft.service';
import { isEligibleForReengage } from './inactivity.util';

@ApiTags('Inactivity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations/:id/reengage-suggestion')
export class ReengageSuggestionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: InactivitySettingsService,
    private readonly draftService: ReengageDraftService,
  ) {}

  @Get()
  async get(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      select: {
        organizationId: true,
        inactivityBand: true,
        reengageDismissedAt: true,
        status: true,
        isArchived: true,
      },
    });
    if (!conv) throw new NotFoundException();
    if (conv.organizationId !== orgId) throw new ForbiddenException();

    const cfg = await this.settings.get(orgId);
    const eligible =
      conv.status !== 'CLOSED' &&
      !conv.isArchived &&
      isEligibleForReengage(conv.inactivityBand, cfg.reengageFromBand);

    if (!eligible) {
      return { eligible: false, band: conv.inactivityBand, draft: null };
    }
    const draft = await this.draftService.draft(orgId, id);
    return { eligible: true, band: conv.inactivityBand, draft };
  }

  @Post('dismiss')
  async dismiss(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!conv) throw new NotFoundException();
    if (conv.organizationId !== orgId) throw new ForbiddenException();
    await this.prisma.conversation.update({
      where: { id },
      data: { reengageDismissedAt: new Date() },
    });
    return { ok: true };
  }
}
