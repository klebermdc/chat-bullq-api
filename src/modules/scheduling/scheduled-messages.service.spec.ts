import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { ConversationsService } from '../messaging/conversations/conversations.service';

/**
 * Instância REAL de ConversationsService (só com `prisma` montado), mesmo
 * padrão de messages.access.spec.ts — prova a integração de verdade com
 * `assertConversationAccess`, não um double.
 */
function makeConversationsService(conversationFound: unknown) {
  const guardPrisma: any = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversationFound) },
  };
  const svc: ConversationsService = Object.create(ConversationsService.prototype);
  Object.assign(svc, { prisma: guardPrisma });
  return { conversations: svc, guardPrisma };
}

function makeDeps(opts: { conversationsGuardFinds?: unknown } = {}) {
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
  const { conversations, guardPrisma } = makeConversationsService(
    'conversationsGuardFinds' in opts ? opts.conversationsGuardFinds : { id: 'c1' },
  );
  const service = new ScheduledMessagesService(
    repo as any,
    prisma as any,
    queue as any,
    realtime as any,
    conversations,
  );
  return { service, repo, queue, prisma, rows, guardPrisma };
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

describe('ScheduledMessagesService — escopo por atribuição (AGENT só mexe na própria conversa)', () => {
  const future = '2999-01-01T00:00:00.000Z';

  it('create: AGENT + conversa de colega → NotFound, sem persistir nem enfileirar', async () => {
    const { service, repo, queue } = makeDeps({ conversationsGuardFinds: null });
    await expect(
      service.create(
        { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
        'agent-u1', 'org1', 'ALL', OrgRole.AGENT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('create: AGENT + conversa própria → prossegue', async () => {
    const { service } = makeDeps({ conversationsGuardFinds: { id: 'c1' } });
    const result = await service.create(
      { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
      'agent-u1', 'org1', 'ALL', OrgRole.AGENT,
    );
    expect(result.status).toBe('PENDING');
  });

  it('create: ADMIN não consulta o guard escopado (findFirst sem assignedToId)', async () => {
    const { service, guardPrisma } = makeDeps({ conversationsGuardFinds: { id: 'c1' } });
    await service.create(
      { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
      'admin-u1', 'org1', 'ALL', OrgRole.ADMIN,
    );
    expect(guardPrisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1' },
    });
  });

  it('listForConversation: AGENT + conversa de colega → NotFound', async () => {
    const { service } = makeDeps({ conversationsGuardFinds: null });
    await expect(
      service.listForConversation('c1', 'org1', 'ALL', undefined, OrgRole.AGENT, 'agent-u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancel: AGENT + agendamento de conversa de colega → NotFound, sem tocar na fila', async () => {
    const created = await (async () => {
      const { service } = makeDeps();
      return service.create(
        { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
        'user1', 'org1', 'ALL',
      );
    })();
    const { service, repo, queue } = makeDeps({ conversationsGuardFinds: null });
    repo.findById.mockResolvedValue({ ...created, conversationId: 'c1', organizationId: 'org1', channelId: 'ch1' });
    await expect(
      service.cancel(created.id, 'org1', 'manual', 'ALL', OrgRole.AGENT, 'agent-u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.remove).not.toHaveBeenCalled();
  });

  it('cancel: AGENT + agendamento da própria conversa → prossegue', async () => {
    const { service, repo } = makeDeps({ conversationsGuardFinds: { id: 'c1' } });
    const created = await service.create(
      { conversationId: 'c1', type: 'TEXT', content: { text: 'oi' }, scheduledAt: future },
      'agent-u1', 'org1', 'ALL', OrgRole.AGENT,
    );
    repo.findById.mockResolvedValueOnce({
      ...created, conversationId: 'c1', organizationId: 'org1', channelId: 'ch1', status: 'PENDING',
    });
    const canceled = await service.cancel(created.id, 'org1', 'manual', 'ALL', OrgRole.AGENT, 'agent-u1');
    expect(canceled.status).toBe('CANCELED');
  });

  it('reschedule: AGENT + agendamento de conversa de colega → NotFound', async () => {
    const { service, repo } = makeDeps({ conversationsGuardFinds: null });
    repo.findById.mockResolvedValue({
      id: 's1', conversationId: 'c1', organizationId: 'org1', channelId: 'ch1', status: 'PENDING',
    });
    await expect(
      service.reschedule(
        's1', { scheduledAt: future } as any, 'org1', 'ALL', OrgRole.AGENT, 'agent-u1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
