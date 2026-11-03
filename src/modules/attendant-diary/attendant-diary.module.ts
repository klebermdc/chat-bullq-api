import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { DiaryConfigService } from './diary-config.service';
import { DiaryController } from './diary.controller';
import { DiaryCriteriaService } from './diary-criteria.service';
import { DiaryCron } from './diary.cron';
import { DiaryRepository } from './diary.repository';
import { DiaryService } from './diary.service';
import { DIARY_QUEUE } from './diary.constants';
import { FlightPlanRepository } from './flight-plan.repository';

/**
 * Diário do atendente: todo dia de manhã, métricas e um mini treinamento do
 * dia anterior, mais o plano de voo do dia. Módulo isolado: só lê conversas e não participa do atendimento.
 */
@Module({
  imports: [
    ConfigModule,
    LlmModule,
    BullModule.registerQueue({ name: DIARY_QUEUE }),
  ],
  controllers: [DiaryController],
  providers: [
    DiaryConfigService,
    DiaryCriteriaService,
    DiaryRepository,
    DiaryService,
    DiaryCron,
    FlightPlanRepository,
  ],
})
export class AttendantDiaryModule {}
