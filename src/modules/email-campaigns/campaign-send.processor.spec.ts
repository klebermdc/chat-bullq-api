import { EmailCampaignStatus, EmailMessageStatus, EmailSubscriberStatus } from '@prisma/client';
import { CampaignSendProcessor } from './campaign-send.processor';
import { SuppressionService } from '../email-audience/suppression.service';

function makeDeps(overrides: any = {}) {
  const campaign = {
    id: 'camp_1',
    organizationId: 'org_1',
    subject: 'Oi',
    preheader: null,
    fromName: null,
    content: { blocks: [{ type: 'text', text: 'oi' }] },
    status: EmailCampaignStatus.SENDING,
    ...overrides.campaign,
  };

  const messages: any[] = overrides.messages ?? [
    {
      id: 'msg_1',
      organizationId: 'org_1',
      campaignId: 'camp_1',
      subscriberId: 'sub_1',
      to: 'a@e.com',
      subject: 'Oi',
      dedupKey: 'campaign:camp_1:sub_1',
      status: EmailMessageStatus.PENDING,
    },
  ];

  const subscribersById: Record<string, any> = overrides.subscribersById ?? {
    sub_1: { id: 'sub_1', email: 'a@e.com', name: 'A', status: EmailSubscriberStatus.SUBSCRIBED },
  };

  const prisma: any = {
    emailMessage: {
      findUnique: jest.fn(async ({ where }: any) => {
        const m = messages.find((x) => x.id === where.id);
        return m ? { ...m, campaign } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const m = messages.find((x) => x.id === where.id);
        Object.assign(m, data);
        return m;
      }),
      count: jest.fn(async ({ where }: any) =>
        messages.filter((m) => m.campaignId === where.campaignId && m.status === where.status)
          .length,
      ),
    },
  };

  const sender = {
    // Simula o efeito real do EmailSenderService: em sucesso, a mensagem sai
    // de PENDING. Sem isso, `finishIfDone` nunca veria a fila esvaziar.
    send: jest.fn(async (req: any) => {
      const m = messages.find((x) => x.dedupKey === req.dedupKey);
      if (m) Object.assign(m, { status: EmailMessageStatus.SENT, sentAt: new Date() });
      return m;
    }),
  };

  const subscribers = {
    findById: jest.fn(async (id: string) => subscribersById[id] ?? null),
  };

  // Regra de supressão real (sem dependências) em vez de fake — é o ponto
  // mais crítico do worker, então vale testar contra a lógica de verdade.
  const suppression = new SuppressionService();

  const campaignsRepo = {
    update: jest.fn(async (id: string, data: any) => Object.assign(campaign, data)),
  };

  const processor = new CampaignSendProcessor(
    prisma as any,
    sender as any,
    subscribers as any,
    suppression as any,
    campaignsRepo as any,
  );

  return { processor, prisma, sender, subscribers, campaignsRepo, messages, campaign };
}

function makeJob(messageId: string): any {
  return { data: { messageId } };
}

describe('CampaignSendProcessor', () => {
  it('mensagem PENDING de destinatário inscrito chama sender.send com o dedupKey da mensagem', async () => {
    const { processor, sender, messages } = makeDeps();
    await processor.process(makeJob('msg_1'));
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: messages[0].dedupKey, to: 'a@e.com' }),
    );
  });

  it('destinatário suprimido: sender.send NÃO é chamado e a mensagem vira FAILED com motivo "suprimido: ..."', async () => {
    const { processor, sender, messages } = makeDeps({
      subscribersById: {
        sub_1: {
          id: 'sub_1',
          email: 'a@e.com',
          name: 'A',
          status: EmailSubscriberStatus.UNSUBSCRIBED,
        },
      },
    });
    await processor.process(makeJob('msg_1'));
    expect(sender.send).not.toHaveBeenCalled();
    expect(messages[0].status).toBe(EmailMessageStatus.FAILED);
    expect(messages[0].failedReason).toMatch(/^suprimido:/);
  });

  it('mensagem que já não está PENDING retorna sem fazer nada (idempotência de job reentregue)', async () => {
    const { processor, sender, campaignsRepo, messages } = makeDeps({
      messages: [
        {
          id: 'msg_1',
          organizationId: 'org_1',
          campaignId: 'camp_1',
          subscriberId: 'sub_1',
          to: 'a@e.com',
          subject: 'Oi',
          dedupKey: 'campaign:camp_1:sub_1',
          status: EmailMessageStatus.SENT,
        },
      ],
    });
    await processor.process(makeJob('msg_1'));
    expect(sender.send).not.toHaveBeenCalled();
    expect(campaignsRepo.update).not.toHaveBeenCalled();
    expect(messages[0].status).toBe(EmailMessageStatus.SENT);
  });

  it('quando não sobra nenhuma PENDING, a campanha vira SENT com finishedAt preenchido', async () => {
    const { processor, campaignsRepo, campaign } = makeDeps();
    await processor.process(makeJob('msg_1'));
    expect(campaignsRepo.update).toHaveBeenCalledWith(
      'camp_1',
      expect.objectContaining({ status: EmailCampaignStatus.SENT, finishedAt: expect.any(Date) }),
    );
    expect(campaign.status).toBe(EmailCampaignStatus.SENT);
  });
});
