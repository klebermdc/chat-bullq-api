import { EmailCampaignStatus, EmailMessageStatus, EmailSubscriberStatus } from '@prisma/client';
import { buildAudienceWhere, parseAudienceFilter } from '../email-audience/audience-filter';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CampaignStatsService } from './campaign-stats.service';

function makeFakePrisma() {
  return {
    emailMessage: {
      groupBy: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

/** Fake mínimo de `CampaignsService` — só o que `audienceCount` usa. */
function makeFakeCampaigns(campaign: any) {
  return { findOne: jest.fn(async () => campaign) };
}

/**
 * Casa um destinatário fake contra o `where` produzido por `buildAudienceWhere`.
 * Mesma lógica de `campaign-dispatch.service.spec.ts` — cobre só os campos
 * que o filtro de público de fato usa.
 */
function matches(sub: any, where: any): boolean {
  if (where.organizationId !== undefined && sub.organizationId !== where.organizationId) return false;
  if (where.status !== undefined && sub.status !== where.status) return false;
  if (where.categories?.hasSome && !where.categories.hasSome.some((c: string) => sub.categories.includes(c))) {
    return false;
  }
  if (where.suppliers?.hasSome && !where.suppliers.hasSome.some((s: string) => sub.suppliers.includes(s))) {
    return false;
  }
  if (where.totalSpent?.gte !== undefined && sub.totalSpent < where.totalSpent.gte) return false;
  if (where.orderCount?.gte !== undefined && sub.orderCount < where.orderCount.gte) return false;
  if (where.tags?.some?.tagId?.in && !where.tags.some.tagId.in.some((t: string) => sub.tagIds.includes(t))) {
    return false;
  }
  return true;
}

function fakeSubscribersRepo(subs: any[]) {
  return {
    findByWhere: jest.fn(async (where: any) => subs.filter((s) => matches(s, where))),
    countByWhere: jest.fn(async (where: any) => subs.filter((s) => matches(s, where)).length),
  };
}

describe('CampaignStatsService', () => {
  describe('forCampaign', () => {
    it('mapeia o resultado do groupBy para cada status e zera o que não aparece no agrupamento', async () => {
      const prisma = makeFakePrisma();
      // Prisma só devolve linhas para status com pelo menos 1 registro —
      // aqui faltam DELIVERED, COMPLAINED e FAILED de propósito.
      prisma.emailMessage.groupBy.mockResolvedValue([
        { status: EmailMessageStatus.PENDING, _count: { _all: 3 } },
        { status: EmailMessageStatus.SENT, _count: { _all: 5 } },
        { status: EmailMessageStatus.BOUNCED, _count: { _all: 2 } },
      ]);
      prisma.emailMessage.count
        .mockResolvedValueOnce(4) // opened
        .mockResolvedValueOnce(1) // clicked
        .mockResolvedValueOnce(10); // total

      const service = new CampaignStatsService(prisma as any, makeFakeCampaigns({}) as any, fakeSubscribersRepo([]) as any);
      const stats = await service.forCampaign('camp_1', 'org_1');

      expect(stats).toEqual({
        total: 10,
        pending: 3,
        sent: 5,
        delivered: 0,
        bounced: 2,
        complained: 0,
        failed: 0,
        opened: 4,
        clicked: 1,
      });
      expect(prisma.emailMessage.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { campaignId: 'camp_1', organizationId: 'org_1' },
        _count: { _all: true },
      });
    });

    it('conta destinatários distintos com abertura/clique, não o total de eventos', async () => {
      const prisma = makeFakePrisma();
      prisma.emailMessage.groupBy.mockResolvedValue([]);
      // 2 destinatários abriram (mesmo que tenham aberto várias vezes cada),
      // 1 destinatário clicou.
      prisma.emailMessage.count
        .mockResolvedValueOnce(2) // opened
        .mockResolvedValueOnce(1) // clicked
        .mockResolvedValueOnce(0); // total

      const service = new CampaignStatsService(prisma as any, makeFakeCampaigns({}) as any, fakeSubscribersRepo([]) as any);
      const stats = await service.forCampaign('camp_1', 'org_1');

      expect(stats.opened).toBe(2);
      expect(stats.clicked).toBe(1);
      expect(prisma.emailMessage.count).toHaveBeenNthCalledWith(1, {
        where: { campaignId: 'camp_1', organizationId: 'org_1', openCount: { gt: 0 } },
      });
      expect(prisma.emailMessage.count).toHaveBeenNthCalledWith(2, {
        where: { campaignId: 'camp_1', organizationId: 'org_1', clickCount: { gt: 0 } },
      });
    });

    it('todos os status ausentes viram 0, não undefined', async () => {
      const prisma = makeFakePrisma();
      prisma.emailMessage.groupBy.mockResolvedValue([]);
      prisma.emailMessage.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const service = new CampaignStatsService(prisma as any, makeFakeCampaigns({}) as any, fakeSubscribersRepo([]) as any);
      const stats = await service.forCampaign('camp_1', 'org_1');

      expect(stats.pending).toBe(0);
      expect(stats.sent).toBe(0);
      expect(stats.delivered).toBe(0);
      expect(stats.bounced).toBe(0);
      expect(stats.complained).toBe(0);
      expect(stats.failed).toBe(0);
      for (const value of Object.values(stats)) {
        expect(value).not.toBeUndefined();
      }
    });
  });

  describe('failures', () => {
    it('filtra por FAILED e BOUNCED e devolve o motivo real do provedor', async () => {
      const prisma = makeFakePrisma();
      const rows = [
        { to: 'a@example.com', status: EmailMessageStatus.FAILED, failedReason: 'invalid domain' },
        { to: 'b@example.com', status: EmailMessageStatus.BOUNCED, failedReason: 'mailbox full' },
      ];
      prisma.emailMessage.findMany.mockResolvedValue(rows);

      const service = new CampaignStatsService(prisma as any, makeFakeCampaigns({}) as any, fakeSubscribersRepo([]) as any);
      const result = await service.failures('camp_1', 'org_1');

      expect(result).toBe(rows);
      expect(prisma.emailMessage.findMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'camp_1',
          organizationId: 'org_1',
          status: { in: [EmailMessageStatus.FAILED, EmailMessageStatus.BOUNCED] },
        },
        select: { to: true, status: true, failedReason: true },
        take: 100,
      });
    });
  });

  describe('audienceCount', () => {
    const subs = [
      {
        id: 'sub_1',
        email: 'a@e.com',
        name: 'A',
        organizationId: 'org_1',
        status: EmailSubscriberStatus.SUBSCRIBED,
        categories: ['ingresso'],
        suppliers: [],
        totalSpent: 500,
        orderCount: 2,
        tagIds: [],
      },
      {
        id: 'sub_2',
        email: 'b@e.com',
        name: 'B',
        organizationId: 'org_1',
        status: EmailSubscriberStatus.SUBSCRIBED,
        categories: ['hotel'], // não casa a categoria pedida
        suppliers: [],
        totalSpent: 900,
        orderCount: 5,
        tagIds: [],
      },
      {
        id: 'sub_3',
        email: 'c@e.com',
        name: 'C — descadastrou',
        organizationId: 'org_1',
        status: EmailSubscriberStatus.UNSUBSCRIBED, // casa com o filtro, mas não pode entrar
        categories: ['ingresso'],
        suppliers: [],
        totalSpent: 1000,
        orderCount: 9,
        tagIds: [],
      },
    ];

    it('usa o audienceFilter salvo na campanha quando nenhum filtro vem no corpo', async () => {
      const prisma = makeFakePrisma();
      const campaigns = makeFakeCampaigns({
        id: 'camp_1',
        organizationId: 'org_1',
        audienceFilter: { categories: ['ingresso'] },
      });
      const subscribersRepo = fakeSubscribersRepo(subs);
      const service = new CampaignStatsService(prisma as any, campaigns as any, subscribersRepo as any);

      const result = await service.audienceCount('camp_1', 'org_1');

      expect(result.count).toBe(1); // só sub_1 — sub_2 não casa categoria, sub_3 descadastrou
      expect(result.filter).toEqual({ categories: ['ingresso'] });
    });

    it('usa o filtro do corpo quando fornecido, ignorando o gravado na campanha', async () => {
      const prisma = makeFakePrisma();
      const campaigns = makeFakeCampaigns({
        id: 'camp_1',
        organizationId: 'org_1',
        audienceFilter: { categories: ['ingresso'] },
      });
      const subscribersRepo = fakeSubscribersRepo(subs);
      const service = new CampaignStatsService(prisma as any, campaigns as any, subscribersRepo as any);

      // Corpo pede "hotel" em vez do "ingresso" gravado — tela contando
      // enquanto o operador monta os critérios, antes de salvar.
      const result = await service.audienceCount('camp_1', 'org_1', { categories: ['hotel'] });

      expect(result.count).toBe(1); // só sub_2
      expect(result.filter).toEqual({ categories: ['hotel'] });
    });

    it('filtro vazio no corpo conta toda a base inscrita, não a herdada da campanha', async () => {
      const prisma = makeFakePrisma();
      const campaigns = makeFakeCampaigns({
        id: 'camp_1',
        organizationId: 'org_1',
        audienceFilter: { categories: ['ingresso'] },
      });
      const subscribersRepo = fakeSubscribersRepo(subs);
      const service = new CampaignStatsService(prisma as any, campaigns as any, subscribersRepo as any);

      const result = await service.audienceCount('camp_1', 'org_1', {});

      expect(result.count).toBe(2); // sub_1 e sub_2, SUBSCRIBED — sub_3 nunca entra
    });

    it('rejeita filtro malformado com BadRequestException, não deixa vazar Error genérico', async () => {
      const prisma = makeFakePrisma();
      const campaigns = makeFakeCampaigns({ id: 'camp_1', organizationId: 'org_1', audienceFilter: {} });
      const service = new CampaignStatsService(prisma as any, campaigns as any, fakeSubscribersRepo([]) as any);

      await expect(
        service.audienceCount('camp_1', 'org_1', { minSpent: -5 }),
      ).rejects.toThrow(/minSpent/);
    });

    it(
      'a contagem devolvida é exatamente o número que o disparo expandiria, para o mesmo filtro',
      async () => {
        const audienceFilterRaw = { categories: ['ingresso'], minSpent: 100 };
        const campaign = {
          id: 'camp_1',
          organizationId: 'org_1',
          status: EmailCampaignStatus.DRAFT,
          subject: 'Oi',
          content: { blocks: [{ type: 'text', text: 'oi' }] },
          audienceFilter: audienceFilterRaw,
        };
        const subscribersRepo = fakeSubscribersRepo(subs);
        const statsPrisma = makeFakePrisma();
        const statsService = new CampaignStatsService(
          statsPrisma as any,
          makeFakeCampaigns(campaign) as any,
          subscribersRepo as any,
        );

        // Contagem ANTES do disparo — a pergunta que a tela faz ao operador.
        const promised = await statsService.audienceCount('camp_1', 'org_1');

        // Disparo real, mesma campanha, mesmo repositório de assinantes.
        const messages: any[] = [];
        const dispatchPrisma: any = {
          emailMessage: {
            createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
              const novos = data.filter(
                (d: any) => !skipDuplicates || !messages.some((m) => m.dedupKey === d.dedupKey),
              );
              novos.forEach((d: any, i: number) => messages.push({ id: `msg_${i}`, ...d }));
              return { count: novos.length };
            }),
            findMany: jest.fn(async () => messages),
          },
          $transaction: jest.fn(async (fn: any) => fn(dispatchPrisma)),
        };
        const dispatchCampaigns = { findOne: jest.fn(async () => campaign) };
        const campaignsRepo = { update: jest.fn(async (_id: string, data: any) => Object.assign(campaign, data)) };
        const queue = { addBulk: jest.fn(async () => []) };
        const dispatchService = new CampaignDispatchService(
          dispatchPrisma,
          dispatchCampaigns as any,
          campaignsRepo as any,
          subscribersRepo as any,
          queue as any,
        );

        const dispatched = await dispatchService.dispatch('camp_1', 'org_1');

        expect(dispatched.totalRecipients).toBe(promised.count);
        expect(promised.count).toBe(1); // só sub_1 — prova que não é uma coincidência de zero
        expect(messages.map((m) => m.subscriberId)).toEqual(['sub_1']);
      },
    );
  });
});
