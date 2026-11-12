import { StalledHandoffService, STALLED_HANDOFF_REASON } from './stalled-handoff.service';
import { buildStalledHandoffQuery } from './stalled-handoff.sql';

const ROW = {
  conversation_id: 'conv1',
  organization_id: 'org1',
  contact_id: 'ct1',
  channel_id: 'ch1',
  agent_id: 'a1',
  run_id: 'r1',
};

function make(rows: unknown[] | Error, transferImpl?: jest.Mock) {
  const prisma = {
    $queryRaw:
      rows instanceof Error
        ? jest.fn().mockRejectedValue(rows)
        : jest.fn().mockResolvedValue(rows),
  };
  const transfer = {
    queueStalledHandoff: transferImpl ?? jest.fn().mockResolvedValue({ output: {} }),
  };
  const service = new StalledHandoffService(prisma as never, transfer as never);
  return { service, prisma, transfer };
}

describe('StalledHandoffService', () => {
  it('manda cada lead parado para a fila com o contexto do último run da IA', async () => {
    const { service, transfer } = make([ROW]);

    const queued = await service.sweep();

    expect(queued).toBe(1);
    expect(transfer.queueStalledHandoff).toHaveBeenCalledWith(
      {
        organizationId: 'org1',
        conversationId: 'conv1',
        contactId: 'ct1',
        channelId: 'ch1',
        agentId: 'a1',
        runId: 'r1',
      },
      STALLED_HANDOFF_REASON,
    );
  });

  it('uma conversa com erro não impede as outras', async () => {
    const transferImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce({ output: {} });
    const { service } = make([ROW, { ...ROW, conversation_id: 'conv2' }], transferImpl);

    expect(await service.sweep()).toBe(1);
    expect(transferImpl).toHaveBeenCalledTimes(2);
  });

  it('falha na consulta não derruba nada', async () => {
    const { service, transfer } = make(new Error('db down'));

    expect(await service.sweep()).toBe(0);
    expect(transfer.queueStalledHandoff).not.toHaveBeenCalled();
  });
});

describe('buildStalledHandoffQuery', () => {
  const sql = buildStalledHandoffQuery().sql;

  it('só modo SDR, sem dono, aberta, última fala da IA', () => {
    expect(sql).toContain(`ai_security_rules->>'blockCommercialTalk' = 'true'`);
    expect(sql).toContain('c.assigned_to_id IS NULL');
    expect(sql).toContain(`c.status <> 'CLOSED'`);
    expect(sql).toContain(`ultima.direction = 'OUTBOUND'`);
    expect(sql).toContain(`ultima.metadata ? 'aiAgentId'`);
  });

  it('nunca refaz se já houve transferToHuman em qualquer status', () => {
    expect(sql).toContain(`p.tool_name = 'transferToHuman'`);
    expect(sql).not.toContain(`p.status`);
  });
});
