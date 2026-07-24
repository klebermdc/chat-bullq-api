import { ConversationFsmService } from './conversation-fsm.service';

/**
 * A etiqueta do atendente no card é uma TAG de conversa (nome do atendente),
 * NÃO um derivado de assignedToId. Só o fluxo de distribuir criava a tag, e
 * nenhum caminho de reatribuição (dropdown do header, transferir, assumir)
 * sincronizava — a tag do atendente antigo ficava colada pra sempre.
 *
 * fsm.assign é o funil único de troca de assignedToId. Estes testes travam o
 * comportamento: ao trocar de atendente, remove a tag do antigo e adiciona a
 * do novo.
 */
function makeFsm(conversationOverrides: Record<string, unknown> = {}) {
  const conversation = {
    id: 'conv1',
    organizationId: 'org1',
    contactId: 'contact1',
    channelId: 'chan1',
    status: 'OPEN',
    firstResponseAt: new Date(),
    assignedToId: 'u-barbara',
    ...conversationOverrides,
  };

  const usersById: Record<string, { name: string | null }> = {
    'u-barbara': { name: 'Bárbara' },
    'u-pedro': { name: 'Pedro' },
    'u-noname': { name: '   ' },
  };

  const tx = {
    conversation: { update: jest.fn().mockResolvedValue({}) },
    conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(usersById[where.id] ?? null),
      ),
    },
    conversationTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tag: {
      upsert: jest.fn().mockResolvedValue({ id: 'tag-pedro' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    conversation: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(conversation),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;

  const ratings = { requestRating: jest.fn() } as any;
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) } as any;

  return { svc: new ConversationFsmService(prisma, ratings, outbox), tx };
}

describe('ConversationFsmService.assign — sync da tag do atendente', () => {
  it('remove a tag do atendente anterior e adiciona a do novo ao reatribuir', async () => {
    const { svc, tx } = makeFsm({ assignedToId: 'u-barbara' });

    await svc.assign('conv1', 'u-pedro', 'actor1');

    // Remove SÓ a tag que corresponde ao nome do atendente anterior.
    expect(tx.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'conv1',
        tag: { organizationId: 'org1', name: 'Bárbara' },
      },
    });

    // Adiciona (idempotente) a tag do novo atendente, com uma cor estável e
    // não-cinza pra o selo ficar distinto no inbox.
    expect(tx.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_name: { organizationId: 'org1', name: 'Pedro' } },
        create: expect.objectContaining({ organizationId: 'org1', name: 'Pedro' }),
      }),
    );
    const createArg = tx.tag.upsert.mock.calls[0][0].create;
    expect(createArg.color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(createArg.color).not.toBe('#6B7280');
    expect(tx.conversationTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId_tagId: { conversationId: 'conv1', tagId: 'tag-pedro' } },
      }),
    );
  });

  it('recolore selo antigo que ficou no cinza padrão (sem sobrescrever cor manual)', async () => {
    const { svc, tx } = makeFsm({ assignedToId: 'u-barbara' });
    tx.tag.upsert.mockResolvedValue({ id: 'tag-pedro', color: '#6B7280' });


    await svc.assign('conv1', 'u-pedro', 'actor1');

    expect(tx.tag.update).toHaveBeenCalledWith({
      where: { id: 'tag-pedro' },
      data: { color: expect.stringMatching(/^#[0-9A-F]{6}$/i) },
    });
  });

  it('não sobrescreve cor de selo já colorido', async () => {
    const { svc, tx } = makeFsm({ assignedToId: 'u-barbara' });
    tx.tag.upsert.mockResolvedValue({ id: 'tag-pedro', color: '#123456' });


    await svc.assign('conv1', 'u-pedro', 'actor1');

    expect(tx.tag.update).not.toHaveBeenCalled();
  });

  it('não mexe em tag nenhuma quando reatribui pro MESMO atendente (no-op)', async () => {
    const { svc, tx } = makeFsm({ assignedToId: 'u-pedro' });

    await svc.assign('conv1', 'u-pedro', 'actor1');

    expect(tx.conversationTag.deleteMany).not.toHaveBeenCalled();
    expect(tx.tag.upsert).not.toHaveBeenCalled();
    expect(tx.conversationTag.upsert).not.toHaveBeenCalled();
  });

  it('primeira atribuição (sem atendente anterior) só adiciona, não tenta remover', async () => {
    const { svc, tx } = makeFsm({ assignedToId: null, status: 'PENDING' });

    await svc.assign('conv1', 'u-pedro', 'actor1');

    expect(tx.conversationTag.deleteMany).not.toHaveBeenCalled();
    expect(tx.tag.upsert).toHaveBeenCalled();
    expect(tx.conversationTag.upsert).toHaveBeenCalled();
  });

  it('atendente novo sem nome não cria tag vazia (mas ainda remove a antiga)', async () => {
    const { svc, tx } = makeFsm({ assignedToId: 'u-barbara' });

    await svc.assign('conv1', 'u-noname', 'actor1');

    expect(tx.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'conv1',
        tag: { organizationId: 'org1', name: 'Bárbara' },
      },
    });
    expect(tx.tag.upsert).not.toHaveBeenCalled();
    expect(tx.conversationTag.upsert).not.toHaveBeenCalled();
  });
});
