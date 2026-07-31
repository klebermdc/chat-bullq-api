import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { healthRedisProvider } from './health.redis.provider';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, healthRedisProvider],
})
export class HealthModule {}
