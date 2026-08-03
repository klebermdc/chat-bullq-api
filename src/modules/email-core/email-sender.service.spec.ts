import { EmailMessageStatus } from '@prisma/client';
import { EmailSenderService } from './email-sender.service';

const cfg = {
  apiKey: 're_x',
  webhookSecret: 'whsec_x',
  from: 'marketing@exemplo.com.br',
  unsubscribeSecret: 'segredo',
  publicUrl: 'https://app.exemplo.com.br',
};

function makeFakePrisma() {
  const messages: any[] = [];
  return {
    messages,
    emailMessage: {
      findUnique: jest.fn(async ({ where }: any) =>
        messages.find((m) => (where.id ? m.id === where.id : m.dedupKey === where.dedupKey)) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        if (data.dedupKey && messages.some((m) => m.dedupKey === data.dedupKey)) {
          const e: any = new Error('Unique constraint failed');
          e.code = 'P2002';
          throw e;
        }
        const row = { id: `msg_${messages.length + 1}`, openCount: 0, clickCount: 0, ...data };
        messages.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = messages.find((m) => m.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  };
}

const render = {
  render: jest.fn(
    async (_content: unknown, _vars: unknown, _url: string, _preheader?: string) => ({
      html: '<p>oi</p>',
      text: 'oi',
    }),
  ),
};
const content = { blocks: [{ type: 'text' as const, text: 'oi {{nome}}' }] };

function makeService(prisma: any, resendImpl?: any) {
  const resend = { send: jest.fn(resendImpl ?? (async () => ({ providerId: 'resend_1' }))) };
  return { service: new EmailSenderService(prisma, render as any, resend as any, cfg), resend };
}

const req = {
  organizationId: 'org_1',
  subscriberId: 'sub_1',
  to: 'joao@exemplo.com',
  name: 'João',
  subject: 'Oi',
  content,
  dedupKey: 'campaign:c1:sub_1',
};

describe('EmailSenderService', () => {
  beforeEach(() => render.render.mockClear());

  it('envia e grava a mensagem como SENT com o providerId', async () => {
    const { service, resend } = makeService(makeFakePrisma());
    const msg = await service.send(req);
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(msg!.status).toBe(EmailMessageStatus.SENT);
    expect(msg!.providerId).toBe('resend_1');
    expect(msg!.sentAt).toBeInstanceOf(Date);
  });

  it('monta o link de descadastro do rodapé (página web) a partir da URL pública', async () => {
    const { service } = makeService(makeFakePrisma());
    await service.send(req);
    const url = render.render.mock.calls.at(-1)![2];
    expect(url).toMatch(/^https:\/\/app\.exemplo\.com\.br\/descadastro\/.+/);
  });

  it('manda pro Resend o link de descadastro da API (POST), não o da página', async () => {
    const { service, resend } = makeService(makeFakePrisma());
    await service.send(req);
    const sentPayload = resend.send.mock.calls.at(-1)![0];
    expect(sentPayload.unsubscribePostUrl).toMatch(
      /^https:\/\/app\.exemplo\.com\.br\/api\/v1\/public\/unsubscribe\/.+/,
    );
    expect(sentPayload.unsubscribePostUrl).not.toContain('/descadastro/');
  });

  it('rodapé (página) e header (API) carregam o MESMO token de descadastro', async () => {
    const { service, resend } = makeService(makeFakePrisma());
    await service.send(req);
    const pageUrl = render.render.mock.calls.at(-1)![2] as string;
    const postUrl = resend.send.mock.calls.at(-1)![0].unsubscribePostUrl as string;
    const pageToken = pageUrl.split('/descadastro/')[1];
    const postToken = postUrl.split('/public/unsubscribe/')[1];
    expect(pageToken).toBeTruthy();
    expect(pageToken).toBe(postToken);
  });

  it('é idempotente: reenviar o mesmo dedupKey não chama o Resend de novo', async () => {
    const prisma = makeFakePrisma();
    const { service, resend } = makeService(prisma);
    await service.send(req);
    await service.send(req);
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(prisma.messages).toHaveLength(1);
  });

  it('grava FAILED com o motivo REAL quando o Resend recusa', async () => {
    const { service } = makeService(makeFakePrisma(), async () => {
      throw new Error('Resend recusou (validation_error): The domain is not verified');
    });
    const msg = await service.send(req);
    expect(msg!.status).toBe(EmailMessageStatus.FAILED);
    expect(msg!.failedReason).toContain('The domain is not verified');
    expect(msg!.failedReason).not.toMatch(/status code/);
  });

  it('não lança quando o provedor falha — quem chama decide o retry', async () => {
    const { service } = makeService(makeFakePrisma(), async () => {
      throw new Error('timeout');
    });
    await expect(service.send(req)).resolves.toBeTruthy();
  });
});
