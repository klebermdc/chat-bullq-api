import { EmailCampaignStatus, EmailMessageStatus, EmailSubscriberStatus } from '@prisma/client';
import { buildAudienceWhere, parseAudienceFilter } from '../email-audience/audience-filter';
import { CampaignDispatchService } from './campaign-dispatch.service';

/**
 * Casa um destinatário fake contra o `where` produzido por `buildAudienceWhere`.
 * Cobre só os campos que o filtro de público de fato usa — o suficiente para
 * provar, num teste sem banco, que o `where` passado pelo dispatch é o mesmo
 * que uma contagem produziria.
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

function makeDeps(overrides: any = {}) {
  const messages: any[] = [];
  const campaign = {
    id: 'camp_1',
    organizationId: 'org_1',
    status: EmailCampaignStatus.DRAFT,
    subject: 'Oi',
    content: { blocks: [{ type: 'text', text: 'oi' }] },
    audienceFilter: {},
    ...overrides.campaign,
  };
  const prisma: any = {
    emailMessage: {
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        const novos = data.filter(
          (d: any) => !skipDuplicates || !messages.some((m) => m.dedupKey === d.dedupKey),
        );
        novos.forEach((d: any, i: number) =>
          messages.push({ id: `msg_${messages.length + i + 1}`, ...d }),
        );
        return { count: novos.length };
      }),
      findMany: jest.fn(async () => messages.filter((m) => m.status === EmailMessageStatus.PENDING)),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const campaigns = { findOne: jest.fn(async () => campaign) };
  const campaignsRepo = {
    update: jest.fn(async (_id: string, data: any) => Object.assign(campaign, data)),
  };
  const subs =
    overrides.sendable ??
    [
      { id: 'sub_1', email: 'a@e.com', name: 'A', organizationId: 'org_1' },
      { id: 'sub_2', email: 'b@e.com', name: 'B', organizationId: 'org_1' },
    ].map((s) => ({
      status: EmailSubscriberStatus.SUBSCRIBED,
      categories: [],
      suppliers: [],
      totalSpent: 0,
      orderCount: 0,
      tagIds: [],
      ...s,
    }));
  const subscribersRepo = overrides.subscribersRepo ?? fakeSubscribersRepo(subs);
  const queue = { addBulk: jest.fn(async () => []) };
  const service = new CampaignDispatchService(
    prisma as any,
    campaigns as any,
    campaignsRepo as any,
    subscribersRepo as any,
    queue as any,
  );
  return { service, campaign, queue, messages, subscribersRepo };
}

describe('CampaignDispatchService', () => {
  it('cria uma mensagem PENDING por destinatário e marca a campanha SENDING', async () => {
    const { service, campaign, messages, queue } = makeDeps();
    const r = await service.dispatch('camp_1', 'org_1');
    expect(r.totalRecipients).toBe(2);
    expect(messages).toHaveLength(2);
    expect(messages[0].status).toBe(EmailMessageStatus.PENDING);
    expect(campaign.status).toBe(EmailCampaignStatus.SENDING);
    expect(queue.addBulk).toHaveBeenCalled();
  });

  it('usa dedupKey previsível por campanha e destinatário', async () => {
    const { service, messages } = makeDeps();
    await service.dispatch('camp_1', 'org_1');
    expect(messages.map((m) => m.dedupKey)).toEqual([
      'campaign:camp_1:sub_1',
      'campaign:camp_1:sub_2',
    ]);
  });

  it('retomar NÃO duplica mensagem', async () => {
    const { service, messages, campaign } = makeDeps();
    await service.dispatch('camp_1', 'org_1');
    campaign.status = EmailCampaignStatus.SENDING;
    await service.resume('camp_1', 'org_1');
    expect(messages).toHaveLength(2);
  });

  it('recusa disparo com público vazio, em vez de marcar SENT silenciosamente', async () => {
    const { service } = makeDeps({ sendable: [] });
    await expect(service.dispatch('camp_1', 'org_1')).rejects.toThrow(/nenhum destinat/i);
  });

  it('recusa disparar campanha que já saiu', async () => {
    const { service } = makeDeps({ campaign: { status: EmailCampaignStatus.SENT } });
    await expect(service.dispatch('camp_1', 'org_1')).rejects.toThrow(/rascunho/i);
  });

  it('usa o audienceFilter salvo na campanha, não a base inteira', async () => {
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
    ];
    const { service, messages, campaign } = makeDeps({
      campaign: { audienceFilter: { categories: ['ingresso'] } },
      subscribersRepo: fakeSubscribersRepo(subs),
    });
    const r = await service.dispatch('camp_1', 'org_1');
    expect(r.totalRecipients).toBe(1);
    expect(messages.map((m) => m.subscriberId)).toEqual(['sub_1']);
    expect(campaign.totalRecipients).toBe(1);
  });

  it(
    'a contagem e o disparo expandem exatamente o mesmo conjunto, e ' +
      'UNSUBSCRIBED nunca entra mesmo casando com todos os critérios',
    async () => {
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
          email: 'unsub@e.com',
          name: 'Saiu',
          organizationId: 'org_1',
          status: EmailSubscriberStatus.UNSUBSCRIBED, // casa com tudo, mas não pode entrar
          categories: ['ingresso'],
          suppliers: [],
          totalSpent: 900,
          orderCount: 9,
          tagIds: [],
        },
      ];
      const audienceFilterRaw = { categories: ['ingresso'], minSpent: 100 };
      const { service, messages, subscribersRepo } = makeDeps({
        campaign: { audienceFilter: audienceFilterRaw },
        subscribersRepo: fakeSubscribersRepo(subs),
      });

      // A "contagem" usa a MESMA função que o dispatch usa por baixo dos panos.
      const where = buildAudienceWhere('org_1', parseAudienceFilter(audienceFilterRaw));
      const prometido = await subscribersRepo.countByWhere(where);

      const r = await service.dispatch('camp_1', 'org_1');

      expect(r.totalRecipients).toBe(prometido);
      expect(messages.map((m) => m.subscriberId)).toEqual(['sub_1']);
      expect(messages.some((m) => m.subscriberId === 'sub_2')).toBe(false);
    },
  );
});
