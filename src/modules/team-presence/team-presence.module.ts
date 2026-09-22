import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { PresenceSamplerService } from './presence-sampler.service';
import { TeamPresenceController } from './team-presence.controller';
import { TeamPresenceService } from './team-presence.service';

@Module({
  imports: [RealtimeModule],
  controllers: [TeamPresenceController],
  providers: [TeamPresenceService, PresenceSamplerService],
})
export class TeamPresenceModule {}
