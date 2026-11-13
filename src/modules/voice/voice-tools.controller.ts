import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { VoiceAuthGuard } from './voice-auth.guard';
import { SellerCallRecordService } from './seller-call-record.service';
import { VoiceCallTranscriptDto, VoiceFreeSlotsDto, VoiceScheduleDto } from './voice-tools.dto';
import { VoiceToolsService } from './voice-tools.service';

/** Ferramentas do agente de voz (assinadas com VOICE_SERVICE_SECRET; sem login de usuário). */
@ApiExcludeController()
@UseGuards(VoiceAuthGuard)
@Controller('voice/tools')
export class VoiceToolsController {
  constructor(
    private readonly service: VoiceToolsService,
    private readonly records: SellerCallRecordService,
  ) {}

  @Post('free-slots')
  @HttpCode(200)
  freeSlots(@Body() dto: VoiceFreeSlotsDto) {
    return this.service.freeSlots(dto.conversationId, dto.count);
  }

  @Post('schedule')
  @HttpCode(200)
  schedule(@Body() dto: VoiceScheduleDto) {
    return this.service.schedule(dto);
  }

  /** Fim da ligação do vendedor: transcrição (o resumo é gerado em seguida). */
  @Post('call-transcript')
  @HttpCode(200)
  callTranscript(@Body() dto: VoiceCallTranscriptDto) {
    return this.records.finish(dto);
  }
}
