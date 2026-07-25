import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { InactivityRepository } from './inactivity.repository';
import { InactivitySettingsRepository } from './inactivity-settings.repository';
import { InactivitySettingsService } from './inactivity-settings.service';
import { computeBand, isEligibleForReengage } from './inactivity.util';
import { AutoReengageService } from './auto-reengage.service';
import { isAiParked } from '../../../common/utils/ai-parked.util';
import {
  INACTIVITY_WATCHDOG_QUEUE,
  INACTIVITY_WATCHDOG_JOB,
} from '../scheduling.constants';

/**
 * Varre periodicamente as conversas de cada org com detecção ligada,
 * (re)classifica a faixa de inatividade (definição C) e emite
 * `inactivity:updated` quando a faixa muda. Se `autoReengage` está ligado e a
 * conversa está elegível, delega ao `AutoReengageService.maybeCreate`.
 *
 * Mesmo padrão do RecoveryWatchdogCron: registra um job repeat no boot e
 * processa o scan no worker (não processa no onModuleInit).
 *
 * Nota: orgs SEM row de `InactivitySettings` não são varridas por este loop
 * (só orgs com row `enabled=true`). A row default é criada no primeiro GET/PUT
 * de settings pela org, o que as inclui a partir daí.
 */
@Processor(INACTIVITY_WATCHDOG_QUEUE, { concurrency: 1 })
export class InactivityWatchdogCron
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(InactivityWatchdogCron.name);
  /** De quanto em quanto tempo varre (cron pattern). Default: de hora em hora. */
  private readonly pattern = process.env.INACTIVITY_WATCHDOG_CRON ?? '0 * * * *';

  constructor(
    @InjectQueue(INACTIVITY_WATCHDOG_QUEUE) private readonly queue: Queue,
    private readonly repo: InactivityRepository,
    private readonly settingsRepo: InactivitySettingsRepository,
    private readonly settings: InactivitySettingsService,
    private readonly realtime: RealtimeGateway,
    private readonly autoReengage: AutoReengageService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        INACTIVITY_WATCHDOG_JOB,
        {},
        {
          repeat: { pattern: this.pattern },
          jobId: 'inactivity-watchdog-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
      this.logger.log(`inactivity_watchdog_registered pattern=${this.pattern}`);
    } catch (err) {
      this.logger.error(
        `Falha registrando watchdog de inatividade: ${(err as Error).message}`,
      );
    }
  }

  async process(_job: Job): Promise<{ scanned: number; changed: number }> {
    const orgs = await this.settingsRepo.listEnabledOrgIds();
    const now = new Date();
    let scanned = 0;
    let changed = 0;

    for (const { organizationId } of orgs) {
      const cfg = await this.settings.get(organizationId);
      if (!cfg.enabled) continue;

      const candidates = await this.repo.scanCandidates(organizationId);
      // Agrupa as mudanças de faixa por faixa-alvo (band pode ser null) para
      // emitir um único updateMany por faixa distinta ao fim do org.
      const byTargetBand = new Map<number | null, string[]>();

      for (const c of candidates) {
        scanned++;
        const band = computeBand({
          lastOutboundAt: c.lastOutboundAt,
          lastInboundAt: c.lastInboundAt,
          bandsDays: cfg.bandsDays,
          unit: cfg.bandsUnit,
          now,
        });

        if (band !== c.inactivityBand) {
          const ids = byTargetBand.get(band) ?? [];
          ids.push(c.id);
          byTargetBand.set(band, ids);
          changed++;
          this.realtime.emitToConversation(c.id, 'inactivity:updated', {
            conversationId: c.id,
            inactivityBand: band,
          });
        }

        if (
          cfg.autoReengage &&
          isEligibleForReengage(band, cfg.reengageFromBand) &&
          (!cfg.reengageOnlyAiParked || isAiParked(c))
        ) {
          await this.autoReengage
            .maybeCreate(organizationId, c, band as number, cfg)
            .catch((e) =>
              this.logger.warn(
                `auto_reengage_failed conv=${c.id}: ${(e as Error).message}`,
              ),
            );
        }
      }

      // Um UPDATE em lote por faixa distinta (em vez de N updates sequenciais).
      for (const [band, ids] of byTargetBand) {
        await this.repo.setBandBulk(ids, band);
      }
    }

    this.logger.log(`inactivity_scan scanned=${scanned} changed=${changed}`);
    return { scanned, changed };
  }
}
