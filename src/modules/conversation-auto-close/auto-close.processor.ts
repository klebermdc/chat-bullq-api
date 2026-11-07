import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { buildAutoCloseQuery } from './auto-close.sql';

export const AUTO_CLOSE_QUEUE = 'conversation-auto-close';
export const AUTO_CLOSE_JOB = 'close-inactive';
/** Todo dia às 03:00 de Brasília: ninguém atendendo, lista limpa de manhã. */
export const AUTO_CLOSE_PATTERN = '0 3 * * *';
export const AUTO_CLOSE_TZ = 'America/Sao_Paulo';

@Processor(AUTO_CLOSE_QUEUE, { concurrency: 1 })
export class AutoCloseProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoCloseProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly errors: ErrorReporterService,
  ) {
    super();
  }

  async process(): Promise<{ closed: number }> {
    try {
      const rows = await this.prisma.$queryRaw<{ conversation_id: string }[]>(
        buildAutoCloseQuery(),
      );
      this.logger.log(`auto_close_inactive closed=${rows.length}`);
      return { closed: rows.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`auto_close_inactive falhou: ${msg}`);
      this.errors.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.JOB_FAILED,
        severity: ErrorSeverity.ERROR,
        message: `Fechamento automático de conversas falhou: ${msg}`,
        stack: err instanceof Error ? err.stack : undefined,
        context: { job: AUTO_CLOSE_QUEUE },
      });
      // Relança para o BullMQ tentar de novo (attempts no cron).
      throw err;
    }
  }
}
