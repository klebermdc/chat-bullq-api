import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorIssueStatus, ErrorSeverity, ErrorSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ERROR_CODES } from './error-codes';
import { ErrorReporterService } from './error-reporter.service';

export const ERROR_RETENTION_QUEUE = 'error-retention';
export const ERROR_RETENTION_JOB = 'prune';
/** Todo dia às 04:10. Fora do pico e longe da virada do dia. */
export const ERROR_RETENTION_PATTERN = '10 4 * * *';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Issue resolvido e parado há tanto tempo já não ensina nada. */
const ISSUE_RESOLVIDO_DIAS = 90;
/** Fallback seguro quando o env está ausente ou é lixo — ver `resolveDiasOcorrencia`. */
const DIAS_OCORRENCIA_DEFAULT = 14;

/**
 * Resolve `ERROR_RETENTION_DAYS` de forma defensiva.
 *
 * `Number(undefined)` e `Number('abc')` são NaN, e `new Date(agora - NaN)`
 * é uma Invalid Date — que em uma comparação `lt` do Prisma se comporta de
 * forma imprevisível (na prática, nenhuma linha bate, mas não é algo para
 * confiar). Um valor <1 também é rejeitado: poda com corte "no futuro" ou
 * "hoje" apagaria ocorrências vivas. Errar aqui só se percebe depois que os
 * dados já foram apagados, então o fallback é sempre para o default seguro.
 */
function resolveDiasOcorrencia(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DIAS_OCORRENCIA_DEFAULT;
  }
  return parsed;
}

@Processor(ERROR_RETENTION_QUEUE, { concurrency: 1 })
export class ErrorRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(ErrorRetentionProcessor.name);
  private readonly diasOcorrencia: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    // Mesmo módulo que ErrorReporterService (ver ErrorReporterModule) — não
    // fecha ciclo de DI. O `di-cycle-guard.spec.ts` continua sendo o portão
    // que pegaria isso se algum dia deixasse de ser verdade.
    private readonly errors: ErrorReporterService,
  ) {
    super();
    this.diasOcorrencia = resolveDiasOcorrencia(
      config.get<string>('ERROR_RETENTION_DAYS'),
    );
  }

  async process(): Promise<{ occurrences: number; issues: number }> {
    try {
      const agora = Date.now();
      const corteOcorrencia = new Date(agora - this.diasOcorrencia * DIA_MS);
      const corteIssue = new Date(agora - ISSUE_RESOLVIDO_DIAS * DIA_MS);

      const occurrences = await this.prisma.errorOccurrence.deleteMany({
        where: { occurredAt: { lt: corteOcorrencia } },
      });
      const issues = await this.prisma.errorIssue.deleteMany({
        where: {
          status: ErrorIssueStatus.RESOLVED,
          lastSeenAt: { lt: corteIssue },
        },
      });

      this.logger.log(
        `poda: ${occurrences.count} ocorrencias e ${issues.count} issues resolvidos`,
      );
      return { occurrences: occurrences.count, issues: issues.count };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`poda de erros falhou: ${msg}`);
      this.errors.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.JOB_FAILED,
        severity: ErrorSeverity.ERROR,
        message: `Poda de erros falhou: ${msg}`,
        stack: err instanceof Error ? err.stack : undefined,
        context: { job: 'error-retention' },
      });
      // Assimetria deliberada: este é o ÚNICO job do módulo que relança.
      // Em todo outro lugar `report()` basta e a execução segue (a UI não
      // pode travar por causa do coletor de bug). Aqui não há UI esperando
      // — é um cron isolado — e sem retry a poda simplesmente não acontece
      // naquele dia. Relançar deixa o BullMQ reagendar via `attempts` em
      // `error-retention.cron.ts`, e o relatório acima já capturou o
      // incidente, então não há perda de visibilidade em relançar.
      throw err;
    }
  }
}
