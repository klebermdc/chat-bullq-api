import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ScheduledMessagesService } from './scheduled-messages.service';

function makeDeps() {
  const rows: any[] = [];
  let seq = 0;
  const repo = {
    create: jest.fn(async (data: any) => {
      const row = { id: `s${++seq}`, status: 'PENDING', ...data };
      rows.push(row);
      return row;
    }),
    findById: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    update: jest.fn(async (id: string, data: any) => {
      let row = rows.find((r) => r.id === id);
      if (!row) {
        row = { id };
        rows.push(row);
      }
      Object.assign(row, data);
      return row;
    }),
    findPending: jest.fn(async (): Promise<any[]> => []),
    listByConversation: jest.fn(async () => rows),
  };
  const prisma = {
    conversation: {
      findUnique: jest.fn(async () => ({
        id: 'c1',
        organizationId: 'org1',
        channelId: 'ch1',
        contactId: 'ct1',
        status: 'OPEN',
      })),
    },
  };
  const queue = {
    add: jest.fn(async () => ({ id: 'job1' })),
    remove: jest.fn(async () => undefined),
  };
  const realtime = { emitToConversation: jest.fn() };
  const service = new ScheduledMessagesService(
    repo as any,
    prisma as any,
    queue as any,
    realtime as any,
  );
  return { service, repo, queue, prisma, rows };
}

describe('ScheduledMessagesService.create', () => {
  const future = '2999-01-01T00:00:00.000Z';

  it('cria PENDING e enfileira job com delay e jobId', async () => {
    const { service, repo, queue } = makeDeps();
    const result = await service.create(
      { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
      'user1',
      'org1',
      'ALL',
    );
    expect(result.status).toBe('PENDING');
    expect(repo.create).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(result.id, { jobId: expect.any(String) });
    // Regressão: BullMQ rejeita custom jobId com ':' ("Custom Id cannot contain :").
    const jobOpts = (queue.add.mock.calls[0] as any[])[2];
    expect(String(jobOpts.jobId)).not.toContain(':');
  });

  it('rejeita horário no passado', async () => {
    const { service } = makeDeps();
    await expect(
      service.create(
        { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: '2000-01-01T00:00:00.000Z' },
        'user1',
        'org1',
        'ALL',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ScheduledMessagesService.listForConversation', () => {
  it('rejeita quando a conversa é de outra org', async () => {
    const { service, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValueOnce({
      id: 'c1',
      organizationId: 'orgB',
      channelId: 'ch1',
      contactId: 'ct1',
      status: 'OPEN',
    } as any);
    await expect(
      service.listForConversation('c1', 'orgA', 'ALL'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejeita quando o canal está fora do acesso', async () => {
    const { service } = makeDeps();
    await expect(
      service.listForConversation('c1', 'org1', new Set(['outra-ch'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('retorna as linhas quando org e canal batem', async () => {
    const { service, repo } = makeDeps();
    repo.listByConversation.mockResolvedValueOnce([{ id: 's1' }] as any);
    const rows = await service.listForConversation('c1', 'org1', new Set(['ch1']));
    expect(rows).toEqual([{ id: 's1' }]);
    expect(repo.listByConversation).toHaveBeenCalledWith('c1', undefined);
  });
});

describe('ScheduledMessagesService.cancel', () => {
  const future = '2999-01-01T00:00:00.000Z';

  it('marca CANCELED, remove o job e emite evento', async () => {
    const { service, repo, queue } = makeDeps();
    const created = await service.create(
      { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
      'user1', 'org1', 'ALL',
    );
    const canceled = await service.cancel(created.id, 'org1', 'manual');
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.cancelReason).toBe('manual');
    expect(queue.remove).toHaveBeenCalledWith(created.jobId);
  });

  it('rejeita cancel quando o canal está fora do acesso', async () => {
    const { service } = makeDeps();
    const created = await service.create(
      { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
      'user1', 'org1', 'ALL',
    );
    await expect(
      service.cancel(created.id, 'org1', 'manual', new Set(['outra-ch'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancelPendingForConversation cancela pendentes com o motivo dado', async () => {
    const { service, repo } = makeDeps();
    repo.findPending.mockResolvedValueOnce([{ id: 's1', jobId: 'j1', status: 'PENDING' }]);
    const n = await service.cancelPendingForConversation('c1', 'client_replied', 'AUTO_REENGAGE');
    expect(n).toBe(1);
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'CANCELED', cancelReason: 'client_replied' }));
  });

  it('cancelPendingForConversationIfCancelOnReply só cancela manuais com cancelOnReply', async () => {
    const { service, repo } = makeDeps();
    repo.findPending.mockResolvedValueOnce([
      { id: 's1', jobId: 'j1', status: 'PENDING', cancelOnReply: true },
      { id: 's2', jobId: 'j2', status: 'PENDING', cancelOnReply: false },
    ]);
    const n = await service.cancelPendingForConversationIfCancelOnReply('c1');
    expect(n).toBe(1);
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'CANCELED' }));
  });
});
