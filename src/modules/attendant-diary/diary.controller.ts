import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, Roles } from '../../common/decorators';
import { isValidDay, previousDayKey } from './diary-day';
import { DiaryConfigService } from './diary-config.service';
import { DiaryRepository } from './diary.repository';
import { DIARY_GENERATE_JOB, DIARY_QUEUE, diaryJobOptions } from './diary.constants';
import { DiaryDayQueryDto, DiaryListQueryDto } from './dto/diary-query.dto';
import { GenerateDiaryDto } from './dto/generate-diary.dto';

@ApiTags('Attendant diary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('attendant-diaries')
export class DiaryController {
  constructor(
    private readonly repository: DiaryRepository,
    private readonly config: DiaryConfigService,
    @InjectQueue(DIARY_QUEUE) private readonly queue: Queue,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Diário mais recente do próprio atendente' })
  getMine(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Query() query: DiaryDayQueryDto,
  ) {
    if (query.day && !isValidDay(query.day)) {
      throw new BadRequestException('Dia inválido.');
    }
    return this.repository.findForUser(orgId, userId, query.day);
  }

  @Post(':id/viewed')
  @ApiOperation({ summary: 'Marca o próprio diário como lido' })
  async markViewed(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return { updated: await this.repository.markViewed(orgId, userId, id) };
  }

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Diários da equipe, para o gestor conferir' })
  list(@CurrentOrg('id') orgId: string, @Query() query: DiaryListQueryDto) {
    return this.repository.listForManagers(orgId, query.userId);
  }

  @Get('participants')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Atendentes que participam do diário' })
  async participants(@CurrentOrg('id') orgId: string) {
    const all = await this.repository.findParticipants(this.config.participantEmails);
    return all
      .filter((p) => p.organizationId === orgId)
      .map(({ userId, name }) => ({ userId, name }));
  }

  @Post('generate')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Gera de novo o diário de um participante' })
  async generate(@CurrentOrg('id') orgId: string, @Body() dto: GenerateDiaryDto) {
    const participants = await this.repository.findParticipants(this.config.participantEmails);
    const participant = participants.find(
      (p) => p.userId === dto.userId && p.organizationId === orgId,
    );
    if (!participant) {
      throw new BadRequestException('Este atendente não participa do diário.');
    }
    const lastClosedDay = previousDayKey(new Date(), participant.timeZone);
    const day = dto.day ?? lastClosedDay;
    if (!isValidDay(day) || day > lastClosedDay) {
      throw new BadRequestException('Escolha um dia que já terminou.');
    }
    await this.queue.add(
      DIARY_GENERATE_JOB,
      { organizationId: orgId, userId: dto.userId, day, force: true },
      diaryJobOptions(orgId, dto.userId, day),
    );
    return { queued: true, day };
  }
}
