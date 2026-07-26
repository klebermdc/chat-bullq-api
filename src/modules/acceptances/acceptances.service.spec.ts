import { BadRequestException } from '@nestjs/common';
import { AcceptancesService } from './acceptances.service';

function makePrisma(over: any = {}) {
  return {
    conversation: { findFirst: jest.fn().mockResolvedValue({
      id: 'conv-1', organizationId: 'org-1', contactId: 'ct-1',
      organization: { name: 'Orlando Fast Pass' },
    }) },
    card: { findFirst: jest.fn().mockResolvedValue({ id: 'card-1' }) },
    orderAcceptance: { create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'acc-1', ...data })) },
    ...over,
  } as any;
}

describe('AcceptancesService.createForConversation', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, APP_PUBLIC_URL: 'https://x.test' }; });
  afterEach(() => { process.env = env; });

  it('cria aceite PENDING com token, snapshot e expiresAt, e devolve o link', async () => {
    const prisma = makePrisma();
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    const { acceptance, link } = await svc.createForConversation('org-1', 'conv-1', {
      items: [{ description: 'Ingresso Disney' }],
      termText: undefined,
      createdById: 'user-1',
    });
    expect(acceptance.status).toBe('PENDING');
    expect(acceptance.token).toEqual(expect.any(String));
    expect(acceptance.expiresAt).toBeInstanceOf(Date);
    expect(link).toBe(`https://x.test/aceite/${acceptance.token}`);
    expect(prisma.orderAcceptance.create).toHaveBeenCalledTimes(1);
  });

  it('usa termo default com o nome da org quando termText vazio', async () => {
    const prisma = makePrisma();
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
      items: [], createdById: 'u',
    });
    expect(acceptance.termText).toContain('Orlando Fast Pass');
  });

  it('lança se APP_PUBLIC_URL não estiver setado', async () => {
    delete process.env.APP_PUBLIC_URL;
    const svc = new AcceptancesService(makePrisma(), {} as any, {} as any, {} as any);
    await expect(svc.createForConversation('org-1', 'conv-1', {
      items: [{ description: 'x' }], createdById: 'u',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita conversa de outra org', async () => {
    const prisma = makePrisma({ conversation: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.createForConversation('org-1', 'conv-x', {
      items: [], createdById: 'u',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
