import { EmailCampaignStatus, EmailMessageStatus } from '@prisma/client';
import { CampaignDispatchService } from './campaign-dispatch.service';

function makeDeps(overrides: any = {}) {
  const messages: any[] = [];
  const campaign = {
    id: 'camp_1',
    organizationId: 'org_1',
    status: EmailCampaignStatus.DRAFT,
    subject: 'Oi',
    content: { blocks: [{ type: 'text', text: 'oi' }] },
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
  const subscribers = {
    findSendable: jest.fn(
      async () =>
        overrides.sendable ?? [
          { id: 'sub_1', email: 'a@e.com', name: 'A' },
          { id: 'sub_2', email: 'b@e.com', name: 'B' },
        ],
    ),
  };
  const queue = { addBulk: jest.fn(async () => []) };
  const service = new CampaignDispatchService(
    prisma as any,
    campaigns as any,
    campaignsRepo as any,
    subscribers as any,
    queue as any,
  );
  return { service, campaign, queue, messages };
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
});
