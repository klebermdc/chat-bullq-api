import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { PrismaService } from '../../database/prisma.service';
import { AgendaService } from '../agenda/agenda.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CallingGraphClient } from './outreach/calling-graph.client';
import { LiveKitDialer } from './outreach/livekit-dialer';
import { VOICE_OUTREACH_QUEUE } from './outreach/outreach.constants';
import { OutreachCron, OutreachProcessor } from './outreach/outreach.cron';
import { OutreachService } from './outreach/outreach.service';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceSettingsController } from './voice-settings.controller';
import { VoiceToolsController } from './voice-tools.controller';
import { VoiceToolsService } from './voice-tools.service';
import { SellerCallsController } from './seller-calls.controller';
import { SellerCallsService } from './seller-calls.service';
import { SellerCallRecordService } from './seller-call-record.service';
import { SimulatedRecipients } from '../mystery-shopper/simulated/simulated-recipients.service';
import { CallInsightService } from '../calls/call-insight.service';

// Garante que o Nest monta a voz (ferramentas + ligação de retorno) sem dependência faltando.
describe('VoiceModule (injeção)', () => {
  it('monta controllers, discador, cliente da Meta e a varredura', async () => {
    const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
    const mod = await Test.createTestingModule({
      controllers: [VoiceToolsController, VoiceSettingsController, SellerCallsController],
      providers: [
        VoiceToolsService,
        VoiceAuthGuard,
        CallingGraphClient,
        LiveKitDialer,
        OutreachService,
        OutreachCron,
        OutreachProcessor,
        SellerCallsService,
        SellerCallRecordService,
        { provide: CallInsightService, useValue: {} },
        { provide: SimulatedRecipients, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: {} },
        { provide: AgendaService, useValue: {} },
        { provide: RealtimeGateway, useValue: {} },
        { provide: getQueueToken('outbound-messages'), useValue: queue },
        { provide: getQueueToken(VOICE_OUTREACH_QUEUE), useValue: queue },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(OrgGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    expect(mod.get(LiveKitDialer).configured).toBe(false); // sem LIVEKIT_* não disca
    await mod.get(OutreachCron).onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith('voice-outreach-sweep-cron', { pattern: '*/5 * * * *' }, expect.anything());
  });
});
