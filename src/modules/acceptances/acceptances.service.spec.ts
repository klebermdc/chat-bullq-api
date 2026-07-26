import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
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

describe('AcceptancesService.sign', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, APP_PUBLIC_URL: 'https://x.test' }; });
  afterEach(() => { process.env = env; });

  function baseAcc(over: any = {}) {
    return { id: 'acc-1', organizationId: 'org-1', conversationId: 'conv-1', contactId: 'ct-1',
      cardId: 'card-1', token: 'tok', items: [{ description: 'Ingresso' }], termText: 'Declaro...',
      status: 'PENDING', expiresAt: new Date(Date.now() + 1e9),
      organization: { name: 'OFP' }, ...over };
  }

  it('assina um PENDING: grava nome/ip/ua, gera PDF, sobe no storage e dispara efeitos', async () => {
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc()),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...baseAcc(), ...data, status: 'SIGNED' })),
      },
    } as any;
    const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as any;
    const storage = { put: jest.fn().mockResolvedValue(undefined) } as any;
    const effects = { onSigned: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new AcceptancesService(prisma, pdf, effects, storage);

    const res = await svc.sign('tok', { name: 'João', ip: '1.2.3.4', userAgent: 'UA' });
    expect(res.status).toBe('SIGNED');
    expect(prisma.orderAcceptance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-1' },
      data: expect.objectContaining({ status: 'SIGNED', signerName: 'João', signerIp: '1.2.3.4', signerUserAgent: 'UA' }),
    }));
    expect(pdf.render).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith(expect.stringContaining('acceptances/'), expect.any(Buffer), 'application/pdf');
    expect(effects.onSigned).toHaveBeenCalled();
  });

  it('token inexistente → NotFound', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.sign('nope', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('já assinado → Gone (one-shot)', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(baseAcc({ status: 'SIGNED' })) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.sign('tok', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(GoneException);
  });

  it('expirado → Gone e marca EXPIRED', async () => {
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc({ expiresAt: new Date(Date.now() - 1000) })),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.sign('tok', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(GoneException);
    expect(prisma.orderAcceptance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
  });
});

describe('AcceptancesService.getByToken', () => {
  it('404 quando token não existe', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.getByToken('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PENDING expirado vira EXPIRED na leitura', async () => {
    const acc = { id: 'a', status: 'PENDING', expiresAt: new Date(Date.now() - 1000),
      items: [], termText: 'T', signedAt: null, signerName: null, pdfKey: null,
      organization: { name: 'OFP' } };
    const prisma = { orderAcceptance: {
      findUnique: jest.fn().mockResolvedValue(acc), update: jest.fn().mockResolvedValue({}),
    } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    const view = await svc.getByToken('tok');
    expect(view.status).toBe('EXPIRED');
    expect(view.organizationName).toBe('OFP');
  });
});
