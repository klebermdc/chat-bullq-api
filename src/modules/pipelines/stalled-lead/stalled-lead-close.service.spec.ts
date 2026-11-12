import { OrgRole } from '@prisma/client';
import { StalledLeadCloseService } from './stalled-lead-close.service';
import { buildNoReplyCloseQuery } from './stalled-lead-close.sql';

const ROW = { conversation_id: 'conv1', organization_id: 'org1', owner_id: 'u1' };

function make(rows: unknown[] | Error, markLost?: jest.Mock) {
  const prisma = {
    $queryRaw:
      rows instanceof Error
        ? jest.fn().mockRejectedValue(rows)
        : jest.fn().mockResolvedValue(rows),
  };
  const lostSale = { markLost: markLost ?? jest.fn().mockResolvedValue({}) };
  const service = new StalledLeadCloseService(prisma as never, lostSale as never);
  return { service, lostSale };
}

describe('StalledLeadCloseService', () => {
  it('finaliza como venda perdida "Não respondeu" em nome do OWNER', async () => {
    const { service, lostSale } = make([ROW]);

    expect(await service.sweep()).toBe(1);
    expect(lostSale.markLost).toHaveBeenCalledWith(
      'org1',
      'conv1',
      { reason: 'NO_REPLY' },
      { userId: 'u1', role: OrgRole.OWNER, access: 'ALL' },
    );
  });

  it('uma conversa com erro não impede as outras', async () => {
    const markLost = jest
      .fn()
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce({});
    const { service } = make([ROW, { ...ROW, conversation_id: 'conv2' }], markLost);

    expect(await service.sweep()).toBe(1);
    expect(markLost).toHaveBeenCalledTimes(2);
  });

  it('falha na consulta não derruba nada', async () => {
    const { service, lostSale } = make(new Error('db down'));

    expect(await service.sweep()).toBe(0);
    expect(lostSale.markLost).not.toHaveBeenCalled();
  });
});

describe('buildNoReplyCloseQuery', () => {
  const q = buildNoReplyCloseQuery();

  it('só quem conversou pouco (abaixo do mínimo da fila) e há 48h', () => {
    expect(q.sql).toMatch(/\) < \?/);
    expect(q.values).toEqual(expect.arrayContaining([48, 3]));
  });

  it('nunca fecha lead que passou pela fila nem com cadência ou agendamento vivo', () => {
    expect(q.sql).toContain(`p.tool_name = 'transferToHuman'`);
    expect(q.sql).toContain('cadence_enrollments');
    expect(q.sql).toContain('scheduled_messages');
    expect(q.sql).toContain('c.assigned_to_id IS NULL');
  });
});
