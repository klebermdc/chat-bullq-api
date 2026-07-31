import { ConfigService } from '@nestjs/config';
import { ErrorIssueStatus, ErrorSource } from '@prisma/client';
import { ErrorRetentionProcessor } from './error-retention.processor';
import { ErrorReporterService } from './error-reporter.service';
import { ERROR_CODES } from './error-codes';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const DIA_MS = 24 * 60 * 60 * 1000;

function makeProcessor(
  envValue: string | undefined,
  over: { deleteOccurrences?: jest.Mock; deleteIssues?: jest.Mock } = {},
) {
  const prisma = {
    errorOccurrence: {
      deleteMany:
        over.deleteOccurrences ?? jest.fn().mockResolvedValue({ count: 3 }),
    },
    errorIssue: {
      deleteMany: over.deleteIssues ?? jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const config = {
    get: () => envValue,
  } as unknown as ConfigService;
  const errors = { report: jest.fn() };
  return {
    processor: new ErrorRetentionProcessor(
      prisma as never,
      config,
      errors as unknown as ErrorReporterService,
    ),
    prisma,
    errors,
  };
}

describe('ErrorRetentionProcessor', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('deleta ocorrencias mais velhas que o corte configurado (default 14 dias)', async () => {
    const { processor, prisma } = makeProcessor(undefined);
    await processor.process();

    const where = prisma.errorOccurrence.deleteMany.mock.calls[0][0].where;
    const cutoff = where.occurredAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 14 * DIA_MS).toISOString(),
    );
  });

  it('deleta issues RESOLVED sem atividade ha 90 dias', async () => {
    const { processor, prisma } = makeProcessor(undefined);
    await processor.process();

    const where = prisma.errorIssue.deleteMany.mock.calls[0][0].where;
    expect(where.status).toBe(ErrorIssueStatus.RESOLVED);
    const cutoff = where.lastSeenAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 90 * DIA_MS).toISOString(),
    );
  });

  it('nunca filtra issues por status diferente de RESOLVED (OPEN nao pode ser podado)', async () => {
    const { processor, prisma } = makeProcessor(undefined);
    await processor.process();

    const where = prisma.errorIssue.deleteMany.mock.calls[0][0].where;
    expect(where.status).not.toBe(ErrorIssueStatus.OPEN);
    expect(where.status).not.toBe(ErrorIssueStatus.MUTED);
  });

  it('respeita ERROR_RETENTION_DAYS customizado', async () => {
    const { processor, prisma } = makeProcessor('30');
    await processor.process();

    const where = prisma.errorOccurrence.deleteMany.mock.calls[0][0].where;
    const cutoff = where.occurredAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 30 * DIA_MS).toISOString(),
    );
  });

  it('cai para 14 dias quando o env esta ausente', async () => {
    const { processor, prisma } = makeProcessor(undefined);
    await processor.process();

    const where = prisma.errorOccurrence.deleteMany.mock.calls[0][0].where;
    const cutoff = where.occurredAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 14 * DIA_MS).toISOString(),
    );
  });

  it('cai para 14 dias quando o env e lixo (NaN) e nunca produz Invalid Date', async () => {
    const { processor, prisma } = makeProcessor('abc');
    await processor.process();

    const where = prisma.errorOccurrence.deleteMany.mock.calls[0][0].where;
    const cutoff = where.occurredAt.lt as Date;
    expect(Number.isNaN(cutoff.getTime())).toBe(false);
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 14 * DIA_MS).toISOString(),
    );
  });

  it('rejeita valor abaixo de 1 e cai para o default', async () => {
    const { processor, prisma } = makeProcessor('0');
    await processor.process();

    const where = prisma.errorOccurrence.deleteMany.mock.calls[0][0].where;
    const cutoff = where.occurredAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 14 * DIA_MS).toISOString(),
    );
  });

  it('rejeita valor negativo e cai para o default', async () => {
    const { processor, prisma } = makeProcessor('-5');
    await processor.process();

    const where = prisma.errorOccurrence.deleteMany.mock.calls[0][0].where;
    const cutoff = where.occurredAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(NOW.getTime() - 14 * DIA_MS).toISOString(),
    );
  });

  it('retorna as contagens de ambas as delecoes', async () => {
    const { processor } = makeProcessor(undefined);
    const result = await processor.process();
    expect(result).toEqual({ occurrences: 3, issues: 2 });
  });

  it('reporta e relanca quando a poda falha', async () => {
    const falha = new Error('ECONNREFUSED');
    const { processor, errors } = makeProcessor(undefined, {
      deleteOccurrences: jest.fn().mockRejectedValue(falha),
    });

    await expect(processor.process()).rejects.toThrow('ECONNREFUSED');

    expect(errors.report).toHaveBeenCalledTimes(1);
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ErrorSource.JOB,
        code: ERROR_CODES.JOB_FAILED,
      }),
    );
  });
});
