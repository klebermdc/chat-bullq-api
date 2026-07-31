import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorIssueStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

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
  ) {
    super();
    this.diasOcorrencia = resolveDiasOcorrencia(
      config.get<string>('ERROR_RETENTION_DAYS'),
    );
  }

  async process(): Promise<{ occurrences: number; issues: number }> {
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
  }
}
