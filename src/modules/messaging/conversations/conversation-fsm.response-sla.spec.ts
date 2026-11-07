import { ConversationStatus } from '@prisma/client';
import { ConversationFsmService } from './conversation-fsm.service';

/**
 * Ganchos do SLA de resposta no funil único de dono/status: trocar de dono
 * recalcula o prazo; finalizar encerra a espera.
 */
function makeFsm(conversationOverrides: Record<string, unknown> = {}) {
  const conversation = {
    id: 'conv1',
    organizationId: 'org1',
    contactId: 'contact1',
    channelId: 'chan1',
    status: ConversationStatus.OPEN,
    firstResponseAt: new Date(),
    assignedToId: 'u-barbara',
    ...conversationOverrides,
  };
  const tx = {
    conversation: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Pedro' }) },
    conversationTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    contactTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tag: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'tag' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    conversation: { findUniqueOrThrow: jest.fn().mockResolvedValue(conversation) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  const responseSla = {
    onOwnerChanged: jest.fn().mockResolvedValue(undefined),
    onWaitEnded: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new ConversationFsmService(
    prisma,
    { requestRating: jest.fn().mockResolvedValue(undefined) } as any,
    { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
    { moveOwner: jest.fn().mockResolvedValue('moved') } as any,
    responseSla as any,
  );
  return { svc, responseSla };
}

describe('ConversationFsmService — SLA de resposta', () => {
  it('troca de dono recalcula o prazo', async () => {
    const { svc, responseSla } = makeFsm();

    await svc.assign('conv1', 'u-pedro', 'adm');

    expect(responseSla.onOwnerChanged).toHaveBeenCalledWith('conv1', expect.any(Date));
  });

  it('atribuir ao mesmo dono não mexe no SLA', async () => {
    const { svc, responseSla } = makeFsm();

    await svc.assign('conv1', 'u-barbara', 'adm');

    expect(responseSla.onOwnerChanged).not.toHaveBeenCalled();
  });

  it('finalizar encerra a espera', async () => {
    const { svc, responseSla } = makeFsm();

    await svc.transition('conv1', ConversationStatus.CLOSED, 'adm');

    expect(responseSla.onWaitEnded).toHaveBeenCalledWith('conv1', 'closed', expect.any(Date));
  });

  it('outras transições não encerram', async () => {
    const { svc, responseSla } = makeFsm();

    await svc.transition('conv1', ConversationStatus.WAITING, 'adm');

    expect(responseSla.onWaitEnded).not.toHaveBeenCalled();
  });

  it('sem o serviço de SLA (testes antigos) segue funcionando', async () => {
    const { svc } = makeFsm();
    const bare = new ConversationFsmService(
      (svc as any).prisma,
      (svc as any).ratings,
      (svc as any).outbox,
      (svc as any).legacyOwnerWriter,
    );

    await expect(bare.assign('conv1', 'u-pedro', 'adm')).resolves.toBeUndefined();
  });
});
