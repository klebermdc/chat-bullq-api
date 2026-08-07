import { BadRequestException, GoneException, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
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
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
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
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
      items: [], createdById: 'u',
    });
    expect(acceptance.termText).toContain('Orlando Fast Pass');
  });

  it('lança se APP_PUBLIC_URL não estiver setado', async () => {
    delete process.env.APP_PUBLIC_URL;
    const svc = new AcceptancesService(makePrisma(), {} as any, {} as any, {} as any, {} as any);
    await expect(svc.createForConversation('org-1', 'conv-1', {
      items: [{ description: 'x' }], createdById: 'u',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita conversa de outra org', async () => {
    const prisma = makePrisma({ conversation: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.createForConversation('org-1', 'conv-x', {
      items: [], createdById: 'u',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('createForConversation com vouchers', () => {
    // O spy de `Logger.prototype.warn` é global e acumula chamadas entre
    // testes. Restaurar no fim de cada um (e não no fim do teste, que não roda
    // quando a asserção estoura) impede que o nome forjado daqui vaze para a
    // asserção de log de outro teste.
    afterEach(() => jest.restoreAllMocks());

    it('calcula o SHA-256 do arquivo no backend e persiste', async () => {
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br';
      const created: any[] = [];
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c1',
            contactId: 'ct1',
            organization: { name: 'OFP' },
          }),
        },
        card: { findFirst: jest.fn().mockResolvedValue({ id: 'card1' }) },
        orderAcceptance: {
          create: jest.fn().mockImplementation((args: any) => {
            created.push(args.data);
            return { ...args.data, id: 'acc1' };
          }),
        },
      } as any;
      const storage = {
        getBuffer: jest.fn().mockResolvedValue(Buffer.from('conteudo-do-pdf')),
      } as any;
      const svc = new AcceptancesService(prisma, {} as any, {} as any, storage, {} as any);

      await svc.createForConversation('org-1', 'c1', {
        items: [{ description: 'Magic Kingdom' }],
        createdById: 'u1',
        orderRef: '61293',
        vouchers: [
          {
            url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
            filename: 'voucher.pdf',
            size: 15,
          },
        ],
      });

      const sha = createHash('sha256').update(Buffer.from('conteudo-do-pdf')).digest('hex');
      expect(storage.getBuffer).toHaveBeenCalledWith('media/2026-08-06/a.pdf');
      expect(created[0].orderRef).toBe('61293');
      expect(created[0].vouchers).toEqual([
        {
          url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
          filename: 'voucher.pdf',
          size: 15,
          sha256: sha,
        },
      ]);
    });

    it('persiste o voucher sem hash quando o arquivo some do storage', async () => {
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const created: any[] = [];
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c1',
            contactId: 'ct1',
            organization: { name: 'OFP' },
          }),
        },
        card: { findFirst: jest.fn().mockResolvedValue(null) },
        orderAcceptance: {
          create: jest.fn().mockImplementation((args: any) => {
            created.push(args.data);
            return { ...args.data, id: 'acc1' };
          }),
        },
      } as any;
      const storage = {
        getBuffer: jest.fn().mockRejectedValue(new Error('NoSuchKey')),
      } as any;
      const svc = new AcceptancesService(prisma, {} as any, {} as any, storage, {} as any);

      await svc.createForConversation('org-1', 'c1', {
        items: [{ description: 'X' }],
        createdById: 'u1',
        vouchers: [
          { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v.pdf', size: 9 },
        ],
      });

      expect(created[0].vouchers[0].sha256).toBe('');
    });

    it('URL fora de media/ persiste sem hash e não toca no storage', async () => {
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br';
      const created: any[] = [];
      const prisma = makePrisma({
        orderAcceptance: {
          create: jest.fn().mockImplementation((args: any) => {
            created.push(args.data);
            return { ...args.data, id: 'acc1' };
          }),
        },
      });
      const storage = { getBuffer: jest.fn() } as any;
      const svc = new AcceptancesService(prisma, {} as any, {} as any, storage, {} as any);

      await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
        vouchers: [{
          // O PDF assinado de OUTRO tenant: é exatamente o que o guard de
          // prefixo recusa. Nem lido, nem hasheado — mas o aceite acontece.
          url: 'https://api.x/api/v1/uploads/acceptances/2026-08-06/acc-de-outra-org.pdf',
          filename: 'alheio.pdf',
          size: 9,
        }],
      });

      expect(storage.getBuffer).not.toHaveBeenCalled();
      expect(created[0].vouchers).toEqual([
        {
          url: 'https://api.x/api/v1/uploads/acceptances/2026-08-06/acc-de-outra-org.pdf',
          filename: 'alheio.pdf',
          size: 9,
          sha256: '',
        },
      ]);
    });

    it('não deixa o nome do arquivo forjar linha de log', async () => {
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br';
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const prisma = makePrisma();
      const storage = { getBuffer: jest.fn().mockRejectedValue(new Error('NoSuchKey')) } as any;
      const svc = new AcceptancesService(prisma, {} as any, {} as any, storage, {} as any);

      await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
        vouchers: [{
          url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
          filename: 'v.pdf\n[Nest] LOG forjado',
          size: 9,
        }],
      });

      const logged = warn.mock.calls.map((c) => String(c[0])).join('');
      expect(logged).not.toMatch(/[\n\r]/);
    });

    it('sem vouchers grava lista vazia e orderRef nulo', async () => {
      const prisma = makePrisma();
      const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
      const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
        items: [{ description: 'x' }], createdById: 'u',
      });
      expect(acceptance.vouchers).toEqual([]);
      expect(acceptance.orderRef).toBeNull();
    });
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
    const svc = new AcceptancesService(prisma, pdf, effects, storage, {} as any);

    const res = await svc.sign('tok', { name: 'João', ip: '1.2.3.4', userAgent: 'UA' });
    expect(res.status).toBe('SIGNED');
    expect(prisma.orderAcceptance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-1' },
      data: expect.objectContaining({ status: 'SIGNED', signerName: 'João', signerIp: '1.2.3.4', signerUserAgent: 'UA' }),
    }));
    expect(pdf.render).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith(expect.stringContaining('acceptances/'), expect.any(Buffer), 'application/pdf');
    expect(effects.onSigned).toHaveBeenCalled();
    expect(res).toEqual(expect.objectContaining({ status: 'SIGNED', organizationName: 'OFP', pdfUrl: expect.stringContaining('/api/v1/uploads/') }));
    expect(res).not.toHaveProperty('token');
    expect(res).not.toHaveProperty('signerIp');
  });

  it('token inexistente → NotFound', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.sign('nope', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('já assinado → Gone (one-shot)', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(baseAcc({ status: 'SIGNED' })) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.sign('tok', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(GoneException);
  });

  it('assina mesmo se os efeitos pós-assinatura falharem (não-fatal)', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc()),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...baseAcc(), ...data, status: 'SIGNED' })),
      },
    } as any;
    const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as any;
    const storage = { put: jest.fn().mockResolvedValue(undefined) } as any;
    const effects = { onSigned: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const svc = new AcceptancesService(prisma, pdf, effects, storage, {} as any);
    const res = await svc.sign('tok', { name: 'João', ip: '', userAgent: '' });
    expect(res.status).toBe('SIGNED');
  });

  it('expirado → Gone e marca EXPIRED', async () => {
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc({ expiresAt: new Date(Date.now() - 1000) })),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.sign('tok', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(GoneException);
    expect(prisma.orderAcceptance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
  });
});

describe('AcceptancesService.getByToken', () => {
  it('404 quando token não existe', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.getByToken('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PENDING expirado vira EXPIRED na leitura', async () => {
    const acc = { id: 'a', status: 'PENDING', expiresAt: new Date(Date.now() - 1000),
      items: [], termText: 'T', signedAt: null, signerName: null, pdfKey: null,
      organization: { name: 'OFP' } };
    const prisma = { orderAcceptance: {
      findUnique: jest.fn().mockResolvedValue(acc), update: jest.fn().mockResolvedValue({}),
    } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    const view = await svc.getByToken('tok');
    expect(view.status).toBe('EXPIRED');
    expect(view.organizationName).toBe('OFP');
  });
});

describe('AcceptancesService.resend / status', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, APP_PUBLIC_URL: 'https://x.test' }; });
  afterEach(() => { process.env = env; });

  it('resend renova expiresAt de um PENDING e devolve o link', async () => {
    const prisma = {
      orderAcceptance: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1', token: 'tok', status: 'PENDING', organizationId: 'org-1' }),
        update: jest.fn().mockResolvedValue({ id: 'acc-1', token: 'tok', status: 'PENDING' }),
      },
    } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    const { link } = await svc.resend('org-1', 'acc-1');
    expect(link).toBe('https://x.test/aceite/tok');
    expect(prisma.orderAcceptance.update).toHaveBeenCalled();
  });

  it('resend de um já assinado → Gone', async () => {
    const prisma = { orderAcceptance: {
      findFirst: jest.fn().mockResolvedValue({ id: 'acc-1', token: 'tok', status: 'SIGNED', organizationId: 'org-1' }),
      update: jest.fn(),
    } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.resend('org-1', 'acc-1')).rejects.toBeInstanceOf(GoneException);
  });

  it('status devolve o aceite mais recente da conversa (ou null)', async () => {
    const prisma = { orderAcceptance: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    expect(await svc.getStatusForConversation('org-1', 'conv-1')).toBeNull();
  });
});

describe('AcceptancesService.extractVoucher', () => {
  function build(overrides: {
    buffer?: Buffer;
    text?: string;
    extracted?: { items: any[]; orderRef: string | null };
  }) {
    const storage = {
      getBuffer: jest.fn().mockResolvedValue(overrides.buffer ?? Buffer.from('x')),
    } as any;
    const extractor = {
      extract: jest
        .fn()
        .mockResolvedValue(overrides.extracted ?? { items: [], orderRef: null }),
    } as any;
    const svc = new AcceptancesService(
      {} as any,
      {} as any,
      {} as any,
      storage,
      extractor,
    );
    // A leitura do PDF é trocada por um stub: o teste é do fluxo do serviço,
    // não do pdfjs (esse já tem teste próprio em pdf-text.util.spec.ts).
    (svc as any).readPdfText = jest.fn().mockResolvedValue(overrides.text ?? '');
    return { svc, storage, extractor };
  }

  it('devolve aviso e não chama o LLM quando o PDF não tem texto', async () => {
    const { svc, extractor } = build({ text: '' });

    const out = await svc.extractVoucher('org-1', {
      mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
    });

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(out.items).toEqual([]);
    expect(out.warning).toMatch(/não consegui ler/i);
  });

  it('devolve os itens extraídos quando o PDF tem texto', async () => {
    const { svc } = build({
      text: 'texto do voucher',
      extracted: { items: [{ description: 'Magic Kingdom' }], orderRef: '61293' },
    });

    const out = await svc.extractVoucher('org-1', {
      mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
    });

    expect(out.items).toEqual([{ description: 'Magic Kingdom' }]);
    expect(out.orderRef).toBe('61293');
    expect(out.warning).toBeUndefined();
  });

  it('recusa URL que não é upload nosso', async () => {
    const { svc, storage } = build({});

    await expect(
      svc.extractVoucher('org-1', { mediaUrl: 'https://evil.com/etc/passwd' }),
    ).rejects.toThrow(BadRequestException);
    expect(storage.getBuffer).not.toHaveBeenCalled();
  });

  it('não deixa a chave forjar linha de log (injeção via %0A)', async () => {
    const { svc } = build({});
    (svc as any).storage.getBuffer = jest
      .fn()
      .mockRejectedValue(new Error('NoSuchKey'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      svc.extractVoucher('org-1', {
        mediaUrl: 'media/2026-08-06/a%0A%5BNest%5D+LOG+forjado.pdf',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const logged = warn.mock.calls.map((c) => String(c[0])).join('');
    expect(logged).not.toMatch(/[\n\r]/);
  });

  it('arquivo ausente no storage → NotFound', async () => {
    const { svc } = build({});
    (svc as any).storage.getBuffer = jest
      .fn()
      .mockRejectedValue(new Error('NoSuchKey'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      svc.extractVoucher('org-1', {
        mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
