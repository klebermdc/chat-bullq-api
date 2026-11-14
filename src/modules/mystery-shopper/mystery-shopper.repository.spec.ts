import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MysteryShopperRepository } from './mystery-shopper.repository';

const NUMBER = { id: 'n1', organizationId: 'org', contactId: 'k1', createdAt: new Date('2026-11-13T00:00:00Z') };

describe('MysteryShopperRepository', () => {
  test('visita duplicada (corrida entre varreduras) é ignorada', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' });
    const repository = new MysteryShopperRepository({
      mysteryShopperVisit: { create: jest.fn().mockRejectedValue(duplicate) },
    } as never);
    await expect(repository.createVisit(NUMBER, 'c1')).resolves.toBe(false);
  });

  test('só conversas criadas depois do cadastro e sem visita', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const repository = new MysteryShopperRepository({ conversation: { findMany } } as never);

    expect(await repository.findConversationsWithoutVisit(NUMBER)).toEqual(['c1']);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      contactId: 'k1',
      createdAt: { gte: NUMBER.createdAt },
      mysteryShopperVisit: { is: null },
    });
  });

  test('visitas paradas: EVALUATING com updatedAt antes do limite', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'v1' }]);
    const repository = new MysteryShopperRepository({ mysteryShopperVisit: { findMany } } as never);
    const before = new Date('2026-11-16T11:30:00Z');

    expect(await repository.findStuckEvaluatingIds(before)).toEqual(['v1']);
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'EVALUATING', updatedAt: { lt: before } });
  });

  test.each([
    ['sem custo anterior', null, '0.02'],
    ['soma ao custo anterior', new Prisma.Decimal('0.0123'), '0.0323'],
  ])('salvar avaliação: %s', async (_name, previous, expected) => {
    const findUnique = jest.fn().mockResolvedValue({ costUsd: previous });
    const update = jest.fn().mockResolvedValue({});
    const repository = new MysteryShopperRepository({ mysteryShopperVisit: { findUnique, update } } as never);

    await repository.saveEvaluation('v1', {
      sellerUserId: 'u1',
      sellerName: 'Pedro',
      metrics: {},
      scores: [],
      totalScore: 80,
      summary: {},
      costUsd: 0.02,
    } as never);

    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.costUsd.toString()).toBe(expected);
  });

  test('cadastro reaproveita o contato pelo telefone (com e sem o 9) e marca sem nome', async () => {
    const tx = {
      contact: {
        findFirst: jest.fn().mockResolvedValue({ id: 'k1' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'k1' }),
      },
      mysteryShopperNumber: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'n1', label: 'Chip', createdAt: new Date(), contact: { phone: '5511982015967' } }),
      },
    };
    const repository = new MysteryShopperRepository({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never);

    await repository.addNumber('org', '5511982015967', 'Chip', 'u1');

    expect(tx.contact.findFirst.mock.calls[0][0].where.phone.in).toEqual(['5511982015967', '551182015967']);
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.contact.update.mock.calls[0][0].data).toEqual({ isMysteryShopper: true });
  });

  test('número já ativo = conflito', async () => {
    const tx = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: 'k1' }), create: jest.fn(), update: jest.fn() },
      mysteryShopperNumber: { findFirst: jest.fn().mockResolvedValue({ id: 'n0' }), create: jest.fn() },
    };
    const repository = new MysteryShopperRepository({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never);
    await expect(repository.addNumber('org', '5511982015967', 'Chip', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  describe('simulado', () => {
    const INPUT = { phone: '5511987654321', label: 'Teste', profileName: 'Maria', channelId: 'ch1', userId: 'u1' };
    const txFor = (over: { contact?: unknown; link?: unknown } = {}) => ({
      contact: {
        findFirst: jest.fn().mockResolvedValue(over.contact ?? null),
        create: jest.fn().mockResolvedValue({ id: 'k1' }),
      },
      contactChannel: {
        findFirst: jest.fn().mockResolvedValue(over.link ?? null),
        create: jest.fn().mockResolvedValue({}),
      },
      mysteryShopperNumber: {
        create: jest.fn().mockResolvedValue({ id: 'n1', label: 'Teste', createdAt: new Date(), isSimulated: true, channelId: 'ch1', contact: { phone: '5511987654321' } }),
      },
    });
    const repoFor = (tx: ReturnType<typeof txFor>) =>
      new MysteryShopperRepository({ $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never);

    test('cria contato marcado, vínculo com o canal e número simulado', async () => {
      const tx = txFor();
      const row = await repoFor(tx).createSimulatedNumber('org', INPUT);
      expect(tx.contact.findFirst.mock.calls[0][0].where.phone.in).toEqual(['5511987654321', '551187654321']);
      expect(tx.contactChannel.findFirst.mock.calls[0][0].where).toMatchObject({ channelId: 'ch1', externalId: { in: ['5511987654321', '551187654321'] } });
      expect(tx.contact.create.mock.calls[0][0].data).toMatchObject({ organizationId: 'org', phone: '5511987654321', name: 'Maria', isMysteryShopper: true });
      expect(tx.contactChannel.create.mock.calls[0][0].data).toEqual({ contactId: 'k1', channelId: 'ch1', externalId: '5511987654321', profileName: 'Maria' });
      expect(tx.mysteryShopperNumber.create.mock.calls[0][0].data).toMatchObject({
        organizationId: 'org', contactId: 'k1', label: 'Teste', createdById: 'u1', isSimulated: true, channelId: 'ch1',
      });
      expect(row).toMatchObject({ id: 'n1', isSimulated: true });
    });

    test('colisão com contato existente: devolve null e não cria nada', async () => {
      const tx = txFor({ contact: { id: 'x' } });
      expect(await repoFor(tx).createSimulatedNumber('org', INPUT)).toBeNull();
      expect(tx.contact.create).not.toHaveBeenCalled();
      expect(tx.mysteryShopperNumber.create).not.toHaveBeenCalled();
    });

    test('colisão com vínculo do canal: devolve null', async () => {
      const tx = txFor({ link: { id: 'l' } });
      expect(await repoFor(tx).createSimulatedNumber('org', INPUT)).toBeNull();
      expect(tx.contact.create).not.toHaveBeenCalled();
    });

    test('canais: só WHATSAPP_OFFICIAL ativos e não apagados da org', async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: 'ch1', name: 'Oficial' }]);
      const repository = new MysteryShopperRepository({ channel: { findMany } } as never);
      await repository.findOfficialChannels('org');
      expect(findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org', type: 'WHATSAPP_OFFICIAL', isActive: true, deletedAt: null });
    });

    test('número do simulador: da org e ativo (removedAt nulo)', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const repository = new MysteryShopperRepository({ mysteryShopperNumber: { findFirst } } as never);
      expect(await repository.findNumberForSimulator('org', 'n1')).toBeNull();
      expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'n1', organizationId: 'org', removedAt: null });
    });

    test('mensagens: conversa mais recente do contato no canal, últimas N em ordem cronológica, sem reação/sistema/revogadas', async () => {
      const m = (id: string) => ({ id, direction: 'INBOUND', status: 'SENT', content: {}, createdAt: new Date() });
      const conversation = { findFirst: jest.fn().mockResolvedValue({ id: 'cv1' }) };
      const message = { findMany: jest.fn().mockResolvedValue([m('b'), m('a')]) };
      const repository = new MysteryShopperRepository({ conversation, message } as never);

      const r = await repository.findSimulatorMessages('k1', 'ch1', 200);

      expect(conversation.findFirst.mock.calls[0][0]).toMatchObject({
        where: { contactId: 'k1', channelId: 'ch1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(message.findMany.mock.calls[0][0]).toMatchObject({
        where: { conversationId: 'cv1', revokedAt: null, type: { notIn: ['REACTION', 'SYSTEM'] } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      expect(r.conversationId).toBe('cv1');
      expect(r.messages.map((x) => x.id)).toEqual(['a', 'b']);
    });

    test('mensagens: esconde saída FAILED/QUEUED (cliente real nunca as recebe)', async () => {
      const conversation = { findFirst: jest.fn().mockResolvedValue({ id: 'cv1' }) };
      const message = { findMany: jest.fn().mockResolvedValue([]) };
      const repository = new MysteryShopperRepository({ conversation, message } as never);

      await repository.findSimulatorMessages('k1', 'ch1', 200);

      expect(message.findMany.mock.calls[0][0].where).toMatchObject({
        NOT: { direction: 'OUTBOUND', status: { in: ['FAILED', 'QUEUED'] } },
      });
    });

    test('mensagens: sem conversa, não consulta mensagens', async () => {
      const message = { findMany: jest.fn() };
      const repository = new MysteryShopperRepository({ conversation: { findFirst: jest.fn().mockResolvedValue(null) }, message } as never);
      expect(await repository.findSimulatorMessages('k1', 'ch1', 200)).toEqual({ conversationId: null, messages: [] });
      expect(message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('indicadores', () => {
    const FROM = new Date('2026-10-01T03:00:00Z');
    const TO = new Date('2026-12-01T03:00:00Z');

    test('visitas DONE avaliadas no intervalo, com JSON normalizado e "a melhorar" do resumo', async () => {
      const evaluatedAt = new Date('2026-11-05T10:00:00Z');
      const findMany = jest.fn().mockResolvedValue([
        { id: 'v1', sellerUserId: 'u1', totalScore: 80, scores: [{ criterion: 'ocultoTom' }], metrics: { firstHumanReplyMinutes: 4, followUps: 1, proposalSent: true }, summary: { improvements: ['Perguntar datas', 3] }, evaluatedAt },
        { id: 'v2', sellerUserId: null, totalScore: 40, scores: null, metrics: {}, summary: null, evaluatedAt },
      ]);
      const repository = new MysteryShopperRepository({ mysteryShopperVisit: { findMany } } as never);

      const rows = await repository.findKpiVisits('org', FROM, TO);

      expect(findMany.mock.calls[0][0]).toMatchObject({
        where: { organizationId: 'org', status: 'DONE', totalScore: { not: null }, evaluatedAt: { gte: FROM, lt: TO } },
        orderBy: { evaluatedAt: 'asc' },
      });
      expect(rows[0]).toMatchObject({ id: 'v1', improvements: ['Perguntar datas'], metrics: { firstHumanReplyMinutes: 4, followUps: 1, proposalSent: true } });
      expect(rows[1]).toMatchObject({ scores: [], improvements: [], metrics: { firstHumanReplyMinutes: null, followUps: 0, proposalSent: false } });
    });

    test('abertas do mês: OPEN/EVALUATING criadas no intervalo', async () => {
      const count = jest.fn().mockResolvedValue(3);
      const repository = new MysteryShopperRepository({ mysteryShopperVisit: { count } } as never);

      expect(await repository.countOpenVisits('org', FROM, TO)).toBe(3);
      expect(count.mock.calls[0][0].where).toEqual({
        organizationId: 'org',
        status: { in: ['OPEN', 'EVALUATING'] },
        createdAt: { gte: FROM, lt: TO },
      });
    });

    test.each([
      ['Europe/Lisbon', 'Europe/Lisbon'],
      [null, 'America/Sao_Paulo'],
    ])('fuso da org: %s → %s', async (aiTimezone, expected) => {
      const findUnique = jest.fn().mockResolvedValue({ aiTimezone });
      const repository = new MysteryShopperRepository({ organization: { findUnique } } as never);
      expect(await repository.findOrgTimezone('org')).toBe(expected);
    });
  });
});
