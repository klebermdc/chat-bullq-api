import { BadRequestException } from '@nestjs/common';
import { PendingActionService } from './pending-action.service';

function make(actionOverrides: Record<string, unknown> = {}) {
  const action: any = {
    id: 'pa1',
    conversationId: 'conv1',
    toolName: 'transferToHuman',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    preview: { impact: 'critical' },
    ...actionOverrides,
  };
  const storage = {
    get: jest.fn().mockResolvedValue(action),
    save: jest.fn().mockResolvedValue(undefined),
  } as any;
  const queue = { add: jest.fn() } as any;
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ status: 'PENDING', firstResponseAt: null }),
      update: jest.fn().mockResolvedValue({ id: 'conv1' }),
    },
  } as any;
  return { svc: new PendingActionService(storage, queue, prisma), storage, prisma, action };
}

describe('PendingActionService.distribute', () => {
  it('pausa IA + atribui ao atendente + move pro Esperando + resolve a pendência', async () => {
    const { svc, storage, prisma } = make();
    await svc.distribute('pa1', 'operador1', 'atendente9');

    const upd = prisma.conversation.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'conv1' });
    expect(upd.data).toMatchObject({
      aiEnabled: false,
      assignedToId: 'atendente9',
      awaitingHumanReply: true,
      status: 'OPEN',
    });
    const saved = storage.save.mock.calls[0][0];
    expect(saved.status).toBe('EXECUTED');
  });

  it('não promove status quando a conversa não está PENDING', async () => {
    const { svc, prisma } = make();
    prisma.conversation.findUnique.mockResolvedValue({ status: 'OPEN', firstResponseAt: new Date() });
    await svc.distribute('pa1', 'op1', 'at1');
    const upd = prisma.conversation.update.mock.calls[0][0];
    expect(upd.data.status).toBeUndefined();
    expect(upd.data).toMatchObject({ aiEnabled: false, awaitingHumanReply: true });
  });

  it('exige assignedToId', async () => {
    const { svc } = make();
    await expect(svc.distribute('pa1', 'op1', '')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita se a pendência não está PENDING', async () => {
    const { svc } = make({ status: 'EXECUTED' });
    await expect(svc.distribute('pa1', 'op1', 'at1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
