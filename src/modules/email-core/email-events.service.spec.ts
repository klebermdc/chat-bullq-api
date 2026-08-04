import { EmailMessageStatus, EmailSubscriberStatus } from '@prisma/client';
import { EmailEventsService } from './email-events.service';

function makeDeps() {
  const message = {
    id: 'msg_1',
    organizationId: 'org_1',
    subscriberId: 'sub_1',
    status: EmailMessageStatus.SENT,
    openCount: 0,
    clickCount: 0,
    openedAt: null,
    firstClickedAt: null,
  };
  const events: any[] = [];
  const prisma: any = {
    emailMessage: {
      findUnique: jest.fn(async () => message),
      update: jest.fn(async ({ data }: any) => {
        if (data.openCount?.increment) message.openCount += data.openCount.increment;
        if (data.clickCount?.increment) message.clickCount += data.clickCount.increment;
        const { openCount, clickCount, ...rest } = data;
        Object.assign(message, rest);
        return message;
      }),
    },
    emailEvent: { create: jest.fn(async ({ data }: any) => (events.push(data), data)) },
  };
  const subscribers = { suppress: jest.fn(async () => ({})) };
  const suppression = {
    statusForBounce: jest.fn((t?: string | null) =>
      ['hard', 'permanent'].includes((t ?? '').toLowerCase()) ? EmailSubscriberStatus.BOUNCED : null,
    ),
  };
  return {
    service: new EmailEventsService(prisma, subscribers as any, suppression as any),
    message,
    events,
    subscribers,
  };
}

const evt = (type: string, data: any = {}) => ({
  type,
  created_at: '2026-08-03T12:00:00.000Z',
  data: { email_id: 'resend_1', ...data },
});

describe('EmailEventsService.apply', () => {
  it('grava o evento cru', async () => {
    const { service, events } = makeDeps();
    await service.apply('org_1', evt('email.delivered'));
    expect(events).toHaveLength(1);
    expect(events[0].providerId).toBe('resend_1');
  });

  it('marca DELIVERED', async () => {
    const { service, message } = makeDeps();
    await service.apply('org_1', evt('email.delivered'));
    expect(message.status).toBe(EmailMessageStatus.DELIVERED);
  });

  it('conta abertura sem rebaixar o status', async () => {
    const { service, message } = makeDeps();
    await service.apply('org_1', evt('email.opened'));
    expect(message.openCount).toBe(1);
    expect(message.openedAt).toBeInstanceOf(Date);
    expect(message.status).toBe(EmailMessageStatus.SENT);
  });

  it('guarda a URL do clique', async () => {
    const { service, events } = makeDeps();
    await service.apply('org_1', evt('email.clicked', { click: { link: 'https://exemplo.com/x' } }));
    expect(events[0].url).toBe('https://exemplo.com/x');
  });

  it('bounce permanente SUPRIME o destinatário', async () => {
    const { service, message, subscribers } = makeDeps();
    await service.apply('org_1', evt('email.bounced', { bounce: { type: 'hard' } }));
    expect(message.status).toBe(EmailMessageStatus.BOUNCED);
    expect(subscribers.suppress).toHaveBeenCalledWith(
      'sub_1',
      'org_1',
      EmailSubscriberStatus.BOUNCED,
      expect.any(String),
    );
  });

  it('bounce temporário NÃO suprime', async () => {
    const { service, subscribers } = makeDeps();
    await service.apply('org_1', evt('email.bounced', { bounce: { type: 'soft' } }));
    expect(subscribers.suppress).not.toHaveBeenCalled();
  });

  it('marcação de spam suprime', async () => {
    const { service, message, subscribers } = makeDeps();
    await service.apply('org_1', evt('email.complained'));
    expect(message.status).toBe(EmailMessageStatus.COMPLAINED);
    expect(subscribers.suppress).toHaveBeenCalledWith(
      'sub_1',
      'org_1',
      EmailSubscriberStatus.COMPLAINED,
      expect.any(String),
    );
  });

  it('ignora tipo desconhecido sem explodir, mas registra o evento', async () => {
    const { service, events } = makeDeps();
    await expect(service.apply('org_1', evt('email.qualquer'))).resolves.toBeUndefined();
    expect(events).toHaveLength(1);
  });
});
