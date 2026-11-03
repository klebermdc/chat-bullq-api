import { FlightPlanRepository } from './flight-plan.repository';

const NOW = new Date('2026-11-02T12:00:00Z');
const TODAY = { from: new Date('2026-11-02T03:00:00Z'), to: new Date('2026-11-03T03:00:00Z') };
const HOUR = 60 * 60 * 1000;

function setup() {
  const prisma = {
    conversation: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', lastInboundAt: new Date('2026-11-02T10:00:00Z'), lastOutboundAt: new Date('2026-10-31T10:00:00Z'), contact: { name: ' Ana ' } },
      ]),
    },
    card: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'k1',
          title: 'Disney 4 pessoas',
          value: { toNumber: () => 12000 },
          updatedAt: new Date('2026-10-25T10:00:00Z'),
          pipelineId: 'p1',
          conversationId: null,
          pipeline: { name: 'Vendas' },
          stage: { name: 'Proposta enviada' },
          contact: null,
        },
      ]),
    },
    scheduledMessage: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([
        { conversationId: 'c2', scheduledAt: new Date('2026-11-02T15:00:00Z'), origin: 'CADENCE', contact: { name: 'Rui' } },
      ]),
    },
  };
  const repository = new FlightPlanRepository(prisma as never);
  return { repository, prisma };
}

const build = (repository: FlightPlanRepository) => repository.build('org', 'u1', NOW, TODAY);

describe('FlightPlanRepository', () => {
  test('só olha conversas abertas, da organização e do próprio atendente', async () => {
    const { repository, prisma } = setup();

    await build(repository);

    for (const [args] of prisma.conversation.findMany.mock.calls) {
      expect(args.where).toMatchObject({
        organizationId: 'org',
        assignedToId: 'u1',
        deletedAt: null,
        isArchived: false,
        isGroup: false,
        status: { not: 'CLOSED' },
      });
    }
  });

  test('responder agora: cliente esperando resposta de gente, o mais antigo primeiro', async () => {
    const { repository, prisma } = setup();

    const plan = await build(repository);

    const [args] = prisma.conversation.findMany.mock.calls[0];
    expect(args.where.awaitingHumanReply).toBe(true);
    expect(args.orderBy).toEqual({ lastInboundAt: 'asc' });
    expect(plan.replyNow).toEqual({
      total: 1,
      items: [{ conversationId: 'c1', contactName: 'Ana', since: '2026-11-02T10:00:00.000Z' }],
    });
  });

  test('retomar: cliente calado de 1 a 7 dias, sem venda perdida nem retomada já agendada', async () => {
    const { repository, prisma } = setup();

    const plan = await build(repository);

    const [args] = prisma.conversation.findMany.mock.calls[1];
    expect(args.where).toMatchObject({
      awaitingHumanReply: false,
      lostAt: null,
      lastOutboundAt: { gte: new Date(NOW.getTime() - 7 * 24 * HOUR), lte: new Date(NOW.getTime() - 24 * HOUR) },
      scheduledMessages: { none: { status: 'PENDING' } },
    });
    expect(plan.followUp.items[0].since).toBe('2026-10-31T10:00:00.000Z');
  });

  test('CRM: cards abertos do atendente sem mudança há 3 dias', async () => {
    const { repository, prisma } = setup();

    const plan = await build(repository);

    const [args] = prisma.card.findMany.mock.calls[0];
    expect(args.where).toMatchObject({
      organizationId: 'org',
      assignedToId: 'u1',
      status: 'OPEN',
      updatedAt: { lte: new Date(NOW.getTime() - 3 * 24 * HOUR) },
      pipeline: { archived: false, OR: [{ key: null }, { key: { notIn: ['lost_recovery', 'support'] } }] },
      stage: { type: 'NORMAL' },
    });
    expect(plan.stalledCards.items[0]).toEqual({
      cardId: 'k1',
      pipelineId: 'p1',
      conversationId: null,
      title: 'Disney 4 pessoas',
      contactName: 'Cliente',
      pipelineName: 'Vendas',
      stageName: 'Proposta enviada',
      value: 12000,
      since: '2026-10-25T10:00:00.000Z',
    });
  });

  test('agendado hoje: só mensagens pendentes do dia nas conversas do atendente', async () => {
    const { repository, prisma } = setup();

    const plan = await build(repository);

    const [args] = prisma.scheduledMessage.findMany.mock.calls[0];
    expect(args.where).toMatchObject({
      organizationId: 'org',
      status: 'PENDING',
      scheduledAt: { gte: TODAY.from, lt: TODAY.to },
      conversation: { assignedToId: 'u1', deletedAt: null },
    });
    expect(plan.scheduledToday.items).toEqual([
      { conversationId: 'c2', contactName: 'Rui', at: '2026-11-02T15:00:00.000Z', origin: 'CADENCE' },
    ]);
  });
});
