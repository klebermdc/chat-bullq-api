import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { OrderWatchdogService } from './order-watchdog.service';

/** Fila BullMQ do watchdog de demora sem carrinho. */
export const ORDER_WATCHDOG_QUEUE = 'order-watchdog';
export const ORDER_WATCHDOG_JOB = 'sweep-delay-no-cart';
/** Hora em hora. */
export const ORDER_WATCHDOG_PATTERN = '0 * * * *';

/**
 * Plumbing de agendamento do watchdog de demora sem carrinho. Mesmo padrão do
 * `RecoveryWatchdogCron` / `WatchdogCronService`: registra um repeatable job no
 * boot (`onModuleInit`) e processa a varredura no worker — nunca no
 * `onModuleInit`. Usa BullMQ repeatable em vez de `@nestjs/schedule` pra manter
 * consistência com o resto do projeto (que não depende de @nestjs/schedule).
 *
 * A lógica de decisão fica em `OrderWatchdogService.sweep()` (método público
 * puro, dirigido diretamente no teste unitário); aqui só há a plumbing da fila.
 */
@Processor(ORDER_WATCHDOG_QUEUE, { concurrency: 1 })
export class OrderWatchdogProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(OrderWatchdogProcessor.name);

  constructor(
    private readonly watchdog: OrderWatchdogService,
    @InjectQueue(ORDER_WATCHDOG_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.add(
        ORDER_WATCHDOG_JOB,
        {},
        {
          repeat: { pattern: ORDER_WATCHDOG_PATTERN },
          jobId: 'order-watchdog-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
      this.logger.log(
        `order_watchdog_cron_registered pattern=${ORDER_WATCHDOG_PATTERN}`,
      );
    } catch (err) {
      this.logger.error(
        `Falha registrando cron do order watchdog: ${(err as Error).message}`,
      );
    }
  }

  async process(_job: Job): Promise<void> {
    try {
      await this.watchdog.sweep(new Date());
    } catch (err) {
      this.logger.error(
        `order-watchdog sweep falhou: ${(err as Error).message}`,
      );
    }
  }
}
