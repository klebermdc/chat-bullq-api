import { DiaryRepository } from './diary.repository';

const RANGE = { from: new Date('2026-10-30T03:00:00Z'), to: new Date('2026-10-31T03:00:00Z') };
const EXCLUDED = { notIn: ['REACTION', 'SYSTEM'] };

function setup() {
  const findMany = jest
    .fn()
    .mockResolvedValueOnce([{ conversationId: 'c1' }])
    .mockResolvedValueOnce([
      { conversationId: 'c1', direction: 'OUTBOUND', senderId: 'u1', content: { text: 'Oi' }, createdAt: RANGE.from },
    ]);
  const repository = new DiaryRepository({ message: { findMany } } as never);
  return { repository, findMany };
}

describe('DiaryRepository', () => {
  test('ligação e reação não entram como mensagem do dia', async () => {
    const { repository, findMany } = setup();

    const messages = await repository.findDayMessages('org', 'u1', RANGE);

    expect(findMany.mock.calls[0][0].where.type).toEqual(EXCLUDED);
    expect(findMany.mock.calls[1][0].where.type).toEqual(EXCLUDED);
    expect(messages).toHaveLength(1);
  });

  test('só busca conversas da própria organização e deixa o cliente oculto de fora', async () => {
    const { repository, findMany } = setup();

    await repository.findDayMessages('org', 'u1', RANGE);

    expect(findMany.mock.calls[0][0].where.conversation).toEqual({
      organizationId: 'org',
      contact: { isMysteryShopper: false },
    });
  });

  test('contexto anterior também ignora ligação e reação', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new DiaryRepository({ message: { findMany } } as never);

    await repository.findContextMessages(['c1'], RANGE.from);

    expect(findMany.mock.calls[0][0].where.type).toEqual(EXCLUDED);
  });
});

describe('DiaryRepository.findParticipants', () => {
  const member = {
    organizationId: 'org',
    userId: 'u1',
    user: { name: 'Ana', email: 'ana@ofp.com.br' },
    organization: { aiTimezone: null },
  };

  function participantsSetup() {
    const findMany = jest.fn().mockResolvedValue([member]);
    const repository = new DiaryRepository({ userOrganization: { findMany } } as never);
    return { repository, findMany };
  }

  test('sem e-mail nem domínio não consulta ninguém', async () => {
    const { repository, findMany } = participantsSetup();

    const result = await repository.findParticipants({ emails: [], domains: [] });

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('domínio inclui só atendentes (AGENT) ativos daquele domínio', async () => {
    const { repository, findMany } = participantsSetup();

    await repository.findParticipants({ emails: ['gestor@ofp.com.br'], domains: ['@ofp.com.br'] });

    const where = findMany.mock.calls[0][0].where;
    expect(where.user).toEqual({ isActive: true, deletedAt: null });
    expect(where.OR).toEqual([
      { user: { email: { in: ['gestor@ofp.com.br'], mode: 'insensitive' } } },
      { role: 'AGENT', user: { email: { endsWith: '@ofp.com.br', mode: 'insensitive' } } },
    ]);
  });

  test('devolve fuso padrão quando a organização não tem', async () => {
    const { repository } = participantsSetup();

    const [participant] = await repository.findParticipants({ emails: [], domains: ['@ofp.com.br'] });

    expect(participant).toEqual({
      organizationId: 'org',
      userId: 'u1',
      name: 'Ana',
      email: 'ana@ofp.com.br',
      timeZone: 'America/Sao_Paulo',
    });
  });
});
