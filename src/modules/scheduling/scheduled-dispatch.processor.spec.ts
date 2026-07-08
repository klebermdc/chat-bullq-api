import { ScheduledDispatchProcessor } from './scheduled-dispatch.processor';

function makeDeps(row: any) {
  const repo = {
    findById: jest.fn(async () => row),
    update: jest.fn(async (id: string, data: any) => ({ ...row, ...data })),
  };
  const prisma = {
    conversation: {
      findUnique: jest.fn(async () => ({ id: 'c1', status: 'OPEN', isArchived: false })),
    },
  };
  const messages = { send: jest.fn(async () => ({ id: 'm1' })) };
  const processor = new ScheduledDispatchProcessor(repo as any, prisma as any, messages as any);
  return { processor, repo, messages };
}

describe('ScheduledDispatchProcessor', () => {
  const base = {
    id: 's1', status: 'PENDING', conversationId: 'c1', organizationId: 'org1',
    createdById: 'user1', contentType: 'TEXT', content: { text: 'oi' },
    origin: 'MANUAL', attempt: 1, maxAttempts: 1,
  };

  it('envia e marca SENT', async () => {
    const { processor, repo, messages } = makeDeps(base);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'SENT', sentMessageId: 'm1' }));
  });

  it('no-op idempotente quando já não está PENDING', async () => {
    const { processor, messages } = makeDeps({ ...base, status: 'CANCELED' });
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('marca FAILED quando a conversa está fechada', async () => {
    const row = { ...base };
    const repo = { findById: jest.fn(async () => row), update: jest.fn(async (id, d) => ({ ...row, ...d })) };
    const prisma = { conversation: { findUnique: jest.fn(async () => ({ id: 'c1', status: 'CLOSED', isArchived: false })) } };
    const messages = { send: jest.fn() };
    const processor = new ScheduledDispatchProcessor(repo as any, prisma as any, messages as any);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'FAILED' }));
  });
});
