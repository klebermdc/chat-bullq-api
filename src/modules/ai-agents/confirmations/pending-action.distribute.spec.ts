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
      findUnique: jest.fn().mockResolvedValue({
        status: 'PENDING',
        firstResponseAt: null,
        organizationId: 'org1',
      }),
      update: jest.fn().mockResolvedValue({ id: 'conv1' }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Renata' }) },
    tag: { upsert: jest.fn().mockResolvedValue({ id: 'tag1' }) },
    conversationTag: { upsert: jest.fn().mockResolvedValue({}) },
    card: {
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 0 } }),
      update: jest.fn().mockResolvedValue({}),
    },
    pipelineStage: { findFirst: jest.fn().mockResolvedValue(null) },
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
    // NÃO resolve: fica PENDING (card permanece como "norte") mas marcado
    // como distribuído.
    const saved = storage.save.mock.calls[0][0];
    expect(saved.status).toBe('PENDING');
    expect(saved.args).toMatchObject({ distributedTo: 'atendente9' });
    expect(saved.preview.action).toContain('Distribuído para');
  });

  it('não promove status quando a conversa não está PENDING', async () => {
    const { svc, prisma } = make();
    prisma.conversation.findUnique.mockResolvedValue({ status: 'OPEN', firstResponseAt: new Date() });
    await svc.distribute('pa1', 'op1', 'at1');
    const upd = prisma.conversation.update.mock.calls[0][0];
    expect(upd.data.status).toBeUndefined();
    expect(upd.data).toMatchObject({ aiEnabled: false, awaitingHumanReply: true });
  });

  it('aplica a tag com o nome do atendente', async () => {
    const { svc, prisma } = make();
    await svc.distribute('pa1', 'op1', 'atendente9');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'atendente9' },
      select: { name: true },
    });
    expect(prisma.tag.upsert.mock.calls[0][0].create).toMatchObject({
      organizationId: 'org1',
      name: 'Renata',
    });
    expect(prisma.conversationTag.upsert).toHaveBeenCalled();
  });

  it('NÃO move o card no distribuir (Coletando só no Iniciar atendimento)', async () => {
    const { svc, prisma } = make();
    prisma.card.findFirst.mockResolvedValue({ id: 'card1', pipelineId: 'pl1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-coleta' });
    await svc.distribute('pa1', 'op1', 'at1');
    // O card permanece em "Distribuir" — só vai pra Coletando no approve.
    expect(prisma.card.update).not.toHaveBeenCalled();
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

describe('PendingActionService.reject — tira o lead da fila "Esperando"', () => {
  it('handoff rejeitado limpa awaitingHumanReply (lead volta pro bot)', async () => {
    const { svc, prisma } = make(); // toolName default = transferToHuman
    await svc.reject('pa1', 'op1', 'ainda não qualificado');
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv1' },
      data: { awaitingHumanReply: false },
    });
  });

  it('rejeição de ação NÃO-handoff não mexe na conversa', async () => {
    const { svc, prisma } = make({ toolName: 'grantAccess' });
    await svc.reject('pa1', 'op1', 'não autorizado');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
