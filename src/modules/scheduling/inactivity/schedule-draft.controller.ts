import {
  Controller,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { PrismaService } from '../../../database/prisma.service';
import { ReengageDraftService } from './reengage-draft.service';

/**
 * Rascunho de mensagem sob demanda (botão "Sugerir com IA" no agendamento).
 * Reusa o ReengageDraftService, mas SEM o gate de inatividade — pode ser
 * chamado a qualquer momento para pré-preencher o compositor de agendamento.
 */
@ApiTags('Scheduling')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations/:id/schedule-draft')
export class ScheduleDraftController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly draftService: ReengageDraftService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Gera um rascunho de mensagem (IA) para a conversa' })
  async get(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!conv) throw new NotFoundException();
    if (conv.organizationId !== orgId) throw new ForbiddenException();

    const draft = await this.draftService.draft(orgId, id);
    return { draft };
  }
}
