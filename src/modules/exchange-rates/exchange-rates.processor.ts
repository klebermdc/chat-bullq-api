import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { ExchangeRatesService, RefreshResult } from './exchange-rates.service';

export const EXCHANGE_RATES_QUEUE = 'operator-exchange-rates';
export const EXCHANGE_RATES_JOB = 'refresh';
/** A cada 5h (0h, 5h, 10h, 15h, 20h), pedido do Kleber em 19/11/2026. */
export const EXCHANGE_RATES_PATTERN = '0 */5 * * *';
export const EXCHANGE_RATES_TZ = 'America/Sao_Paulo';

@Processor(EXCHANGE_RATES_QUEUE, { concurrency: 1 })
export class ExchangeRatesProcessor extends WorkerHost {
  constructor(
    private readonly rates: ExchangeRatesService,
    private readonly errors: ErrorReporterService,
  ) {
    super();
  }

  async process(): Promise<RefreshResult> {
    const result = await this.rates.refreshAll();
    for (const f of result.failed) {
      // Uma operadora fora do ar não deve gerar retentativa das outras: só registra.
      this.errors.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.JOB_FAILED,
        severity: ErrorSeverity.WARNING,
        message: `Câmbio da operadora ${f.code} não foi lido: ${f.error}`,
        context: { job: EXCHANGE_RATES_QUEUE, operator: f.code },
      });
    }
    return result;
  }
}
