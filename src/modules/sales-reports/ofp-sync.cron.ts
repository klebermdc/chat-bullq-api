import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfpSyncService } from './ofp-sync.service';

const HOUR_MS = 60 * 60 * 1000;
const BOOT_DELAY_MS = 20 * 1000;

@Injectable()
export class OfpSyncCron implements OnModuleInit {
  private readonly logger = new Logger(OfpSyncCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sync: OfpSyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('OFP_SYNC_CRON_ENABLED') !== 'true') {
      this.logger.log('OFP sync cron desativado (OFP_SYNC_CRON_ENABLED != true)');
      return;
    }
    this.logger.log('OFP sync cron ativo — sync no boot + intervalo de 1h');
    const run = () =>
      this.sync.sync().catch((e) => this.logger.error(`Cron sync falhou: ${e?.message}`));

    // Sync inicial pouco depois do boot (deixa a app subir primeiro / cobre pós-deploy).
    const boot = setTimeout(run, BOOT_DELAY_MS);
    if (boot.unref) boot.unref();

    // Depois, de hora em hora.
    this.timer = setInterval(run, HOUR_MS);
    if (this.timer.unref) this.timer.unref();
  }
}
