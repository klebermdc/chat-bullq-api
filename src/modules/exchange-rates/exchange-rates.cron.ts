import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  EXCHANGE_RATES_JOB,
  EXCHANGE_RATES_PATTERN,
  EXCHANGE_RATES_QUEUE,
  EXCHANGE_RATES_TZ,
} from './exchange-rates.processor';

const JOB_OPTS = { removeOnComplete: 10, removeOnFail: 10 };

/** Agenda a busca de 5 em 5h e faz uma leitura logo no boot (tela não fica vazia). */
@Injectable()
export class ExchangeRatesCron implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRatesCron.name);

  constructor(@InjectQueue(EXCHANGE_RATES_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'operator-exchange-rates-cron',
        { pattern: EXCHANGE_RATES_PATTERN, tz: EXCHANGE_RATES_TZ },
        { name: EXCHANGE_RATES_JOB, data: {}, opts: JOB_OPTS },
      );
      await this.queue.add(EXCHANGE_RATES_JOB, {}, JOB_OPTS);
      this.logger.log(`câmbio das operadoras agendado: ${EXCHANGE_RATES_PATTERN} ${EXCHANGE_RATES_TZ}`);
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar câmbio das operadoras: ${msg}`);
    }
  }
}
