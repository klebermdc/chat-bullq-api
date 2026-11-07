import { ErrorSource } from '@prisma/client';
import { ERROR_CODES } from '../error-reporter/error-codes';
import type { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { AutoCloseProcessor } from './auto-close.processor';
import { AUTO_CLOSE_TRIGGER, buildAutoCloseQuery } from './auto-close.sql';

function makeProcessor(queryRaw: jest.Mock) {
  const prisma = { $queryRaw: queryRaw };
  const errors = { report: jest.fn() };
  const processor = new AutoCloseProcessor(
    prisma as never,
    errors as unknown as ErrorReporterService,
  );
  return { processor, errors };
}

describe('AutoCloseProcessor', () => {
  it('retorna quantas conversas a query fechou', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([{ conversation_id: 'a' }, { conversation_id: 'b' }]);
    const { processor } = makeProcessor(queryRaw);

    const result = await processor.process();

    expect(result).toEqual({ closed: 2 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('reporta e relança quando a query falha, para o BullMQ tentar de novo', async () => {
    const queryRaw = jest.fn().mockRejectedValue(new Error('db down'));
    const { processor, errors } = makeProcessor(queryRaw);

    await expect(processor.process()).rejects.toThrow('db down');
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ErrorSource.JOB,
        code: ERROR_CODES.JOB_FAILED,
      }),
    );
  });
});

describe('buildAutoCloseQuery', () => {
  const sql = buildAutoCloseQuery().sql;

  it('só age em orgs que ligaram o prazo (opt-in)', () => {
    expect(sql).toContain(`jsonb_typeof(o.settings->'autoCloseInactiveDays') = 'number'`);
    expect(sql).toContain('>= 1');
  });

  it('poupa conversas com mensagem agendada ou cadência viva', () => {
    expect(sql).toMatch(/scheduled_messages[\s\S]*'PENDING', 'SENDING'/);
    expect(sql).toMatch(/cadence_enrollments[\s\S]*'ACTIVE', 'PAUSED'/);
  });

  it('grava o audit log com o gatilho do fechamento automático', () => {
    expect(sql).toContain('conversation_audit_logs');
    expect(buildAutoCloseQuery().values).toContain(AUTO_CLOSE_TRIGGER);
  });
});
