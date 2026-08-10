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
    expect(acceptance.termText).toBe(
      'Declaro que recebi da Orlando Fast Pass todos os produtos e/ou serviços relacionados abaixo ' +
        'e que realizei a conferência das respectivas datas, quantidades, informações e demais detalhes. ' +
        'Confirmo que os itens estão corretos, completos e de acordo com o que foi previamente contratado e acordado.',
    );
  });

  it('termo customizado do atendente vence o default', async () => {
    const prisma = makePrisma();
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
      items: [], createdById: 'u', termText: '  Termo escrito à mão pelo atendente.  ',
    });
    expect(acceptance.termText).toBe('Termo escrito à mão pelo atendente.');
    expect(acceptance.termText).not.toContain('Declaro que recebi da');
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

  describe('snapshot da política de cancelamento', () => {
    /**
     * Prisma de mentira com a org MUTÁVEL: `conversation.findFirst` lê a
     * política vigente no momento da chamada e `orderAcceptance.findUnique`
     * devolve o que ficou gravado. Sem essa mutabilidade não dá pra provar
     * que editar a configuração não reescreve um aceite já criado.
     */
    function makeDb(cancellationPolicy: string | null) {
      const org = { name: 'OFP', cancellationPolicy };
      const rows: any[] = [];
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockImplementation(async () => ({
            id: 'conv-1', contactId: 'ct-1', organization: { ...org },
          })),
        },
        card: { findFirst: jest.fn().mockResolvedValue({ id: 'card-1' }) },
        orderAcceptance: {
          create: jest.fn().mockImplementation(async ({ data }: any) => {
            const row = { id: `acc-${rows.length + 1}`, ...data, organization: { name: org.name } };
            rows.push(row);
            return row;
          }),
          findUnique: jest.fn().mockImplementation(async ({ where }: any) =>
            rows.find((r) => r.token === where.token) ?? null),
          update: jest.fn().mockImplementation(async ({ where, data }: any) => {
            const row = rows.find((r) => r.id === where.id);
            Object.assign(row, data);
            return row;
          }),
        },
      } as any;
      return { prisma, org };
    }

    it('copia a política da org para o aceite na criação', async () => {
      const { prisma } = makeDb('Cancelamentos em até 7 dias.');
      const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
      const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
      });
      expect(acceptance.policyText).toBe('Cancelamentos em até 7 dias.');
    });

    it('org sem política grava null (aceite não exibe o bloco)', async () => {
      const { prisma } = makeDb(null);
      const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
      const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
      });
      expect(acceptance.policyText).toBeNull();
    });

    it('política só com espaços em branco grava null', async () => {
      const { prisma } = makeDb('   \n  ');
      const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
      const { acceptance } = await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
      });
      expect(acceptance.policyText).toBeNull();
    });

    it('editar a política da org NÃO altera um aceite já criado', async () => {
      const { prisma, org } = makeDb('Política de agosto: reembolso integral.');
      const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);

      const { acceptance: antigo } = await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
      });

      // O dono reescreve a política três meses depois.
      org.cancellationPolicy = 'Política de novembro: sem reembolso.';

      const { acceptance: novo } = await svc.createForConversation('org-1', 'conv-1', {
        items: [], createdById: 'u',
      });

      // O aceite novo pega a política nova; o antigo continua com a dele —
      // inclusive quando relido pelo link público, que é o que o cliente vê.
      expect(novo.policyText).toBe('Política de novembro: sem reembolso.');
      const view = await svc.getByToken(antigo.token);
      expect(view.policyText).toBe('Política de agosto: reembolso integral.');
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
      status: 'PENDING', expiresAt: new Date(Date.now() + 1e9), policyText: null,
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

  it('devolve a política assinada na resposta e a manda para o PDF', async () => {
    const acc = baseAcc({ policyText: 'Cancelamento em até 7 dias.' });
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(acc),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...acc, ...data, status: 'SIGNED' })),
      },
    } as any;
    const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as any;
    const storage = { put: jest.fn().mockResolvedValue(undefined) } as any;
    const effects = { onSigned: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new AcceptancesService(prisma, pdf, effects, storage, {} as any);

    const res = await svc.sign('tok', { name: 'João', ip: '', userAgent: '' });
    expect(res.policyText).toBe('Cancelamento em até 7 dias.');
    expect(pdf.render).toHaveBeenCalledWith(
      expect.objectContaining({ policyText: 'Cancelamento em até 7 dias.' }),
    );
  });

  it('aceite sem política devolve policyText null', async () => {
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc()),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...baseAcc(), ...data, status: 'SIGNED' })),
      },
    } as any;
    const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as any;
    const svc = new AcceptancesService(
      prisma, pdf, { onSigned: jest.fn() } as any, { put: jest.fn() } as any, {} as any,
    );
    const res = await svc.sign('tok', { name: 'João', ip: '', userAgent: '' });
    expect(res.policyText).toBeNull();
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

  it('expõe a política do snapshot para a página pública', async () => {
    const acc = { id: 'a', status: 'PENDING', expiresAt: new Date(Date.now() + 1e9),
      items: [], termText: 'T', policyText: 'Cancelamento em até 7 dias.',
      signedAt: null, signerName: null, pdfKey: null, organization: { name: 'OFP' } };
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(acc) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    expect((await svc.getByToken('tok')).policyText).toBe('Cancelamento em até 7 dias.');
  });

  it('aceite antigo (sem coluna preenchida) devolve policyText null', async () => {
    const acc = { id: 'a', status: 'PENDING', expiresAt: new Date(Date.now() + 1e9),
      items: [], termText: 'T', policyText: null,
      signedAt: null, signerName: null, pdfKey: null, organization: { name: 'OFP' } };
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(acc) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any, {} as any);
    expect((await svc.getByToken('tok')).policyText).toBeNull();
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
  const URL_OK = 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf';

  function build(overrides: {
    buffer?: Buffer;
    text?: string;
    images?: Buffer[];
    extracted?: { items: any[]; orderRef: string | null };
    fromImages?: { items: any[]; orderRef: string | null };
  }) {
    const storage = {
      getBuffer: jest.fn().mockResolvedValue(overrides.buffer ?? Buffer.from('x')),
    } as any;
    const extractor = {
      extract: jest
        .fn()
        .mockResolvedValue(overrides.extracted ?? { items: [], orderRef: null }),
      extractFromImages: jest
        .fn()
        .mockResolvedValue(overrides.fromImages ?? { items: [], orderRef: null }),
    } as any;
    const svc = new AcceptancesService(
      {} as any,
      {} as any,
      {} as any,
      storage,
      extractor,
    );
    // A leitura e a rasterização do PDF são trocadas por stubs: o teste é do
    // fluxo do serviço, não do pdfjs (esse já tem teste próprio em
    // pdf-text.util.spec.ts e pdf-render.util.spec.ts).
    (svc as any).readPdfText = jest.fn().mockResolvedValue(overrides.text ?? '');
    const renderPdfPages = jest.fn().mockResolvedValue(overrides.images ?? []);
    (svc as any).renderPdfPages = renderPdfPages;
    return { svc, storage, extractor, renderPdfPages };
  }

  it('PDF com texto não rasteriza nem paga visão — o caminho barato fica barato', async () => {
    const { svc, renderPdfPages, extractor } = build({
      text: 'texto do voucher',
      extracted: { items: [{ description: 'Magic Kingdom' }], orderRef: '61293' },
    });

    const out = await svc.extractVoucher('org-1', { mediaUrl: URL_OK });

    expect(renderPdfPages).not.toHaveBeenCalled();
    expect(extractor.extractFromImages).not.toHaveBeenCalled();
    expect(out.items).toEqual([{ description: 'Magic Kingdom' }]);
    expect(out.orderRef).toBe('61293');
    expect(out.warning).toBeUndefined();
  });

  it('PDF sem texto cai na visão e devolve os itens lidos das imagens', async () => {
    const pages = [Buffer.from('png-1'), Buffer.from('png-2')];
    const { svc, extractor } = build({
      text: '',
      images: pages,
      fromImages: { items: [{ description: 'Universal Studios' }], orderRef: '77' },
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const out = await svc.extractVoucher('org-1', { mediaUrl: URL_OK });

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(extractor.extractFromImages).toHaveBeenCalledWith(pages, 'org-1');
    expect(out.items).toEqual([{ description: 'Universal Studios' }]);
    expect(out.orderRef).toBe('77');
    expect(out.warning).toBeUndefined();
  });

  it('registra o número de páginas ao cair na visão (senão ninguém vê a conta chegar)', async () => {
    const { svc } = build({
      text: '',
      images: [Buffer.from('a'), Buffer.from('b')],
      fromImages: { items: [{ description: 'X' }], orderRef: null },
    });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await svc.extractVoucher('org-1', { mediaUrl: URL_OK });

    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/vis(ã|a)o/i);
    expect(logged).toContain('2');
  });

  it('só o nº do pedido já conta como leitura — não vira aviso', async () => {
    const { svc } = build({
      text: '',
      images: [Buffer.from('a')],
      fromImages: { items: [], orderRef: '61293' },
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const out = await svc.extractVoucher('org-1', { mediaUrl: URL_OK });

    expect(out.orderRef).toBe('61293');
    expect(out.warning).toBeUndefined();
  });

  it('visão também vazia → aviso citando as DUAS tentativas', async () => {
    const { svc, extractor } = build({
      text: '',
      images: [Buffer.from('a')],
      fromImages: { items: [], orderRef: null },
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const out = await svc.extractVoucher('org-1', { mediaUrl: URL_OK });

    expect(extractor.extractFromImages).toHaveBeenCalled();
    expect(out.items).toEqual([]);
    expect(out.orderRef).toBeNull();
    expect(out.warning).toMatch(/não consegui ler/i);
    expect(out.warning).toMatch(/nem pelo texto nem pela imagem/i);
  });

  it('PDF quebrado (não lê texto nem rasteriza) devolve aviso, nunca erro', async () => {
    // O aceite não pode ser bloqueado por um voucher ilegível: o atendente
    // digita à mão e o voucher vai ao cliente do mesmo jeito.
    const { svc, extractor } = build({ text: '', images: [] });

    const out = await svc.extractVoucher('org-1', { mediaUrl: URL_OK });

    expect(extractor.extract).not.toHaveBeenCalled();
    expect(extractor.extractFromImages).not.toHaveBeenCalled();
    expect(out.items).toEqual([]);
    expect(out.warning).toMatch(/não consegui ler/i);
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

describe('AcceptancesService.extractVoucherText', () => {
  function build(extracted?: { items: any[]; orderRef: string | null }) {
    const extractor = {
      extract: jest
        .fn()
        .mockResolvedValue(extracted ?? { items: [], orderRef: null }),
      extractFromImages: jest.fn(),
    } as any;
    const storage = { getBuffer: jest.fn() } as any;
    const svc = new AcceptancesService(
      {} as any,
      {} as any,
      {} as any,
      storage,
      extractor,
    );
    return { svc, extractor, storage };
  }

  const TEXTO_COLADO = [
    'Ingressos',
    '',
    'WALT DISNEY WORLD - INGRESSO 1 DIA EPCOT',
    'Data: 14/09/2026',
    'Passageiros: 1 Criança(s) - 2 Adulto(s)',
    '',
    'Rodolpho Carvalho Costa da Rocha - Nascimento: 07/11/1988',
  ].join('\n');

  it('devolve os itens lidos do texto colado, com passageiros', async () => {
    const { svc, extractor } = build({
      items: [
        {
          description: 'WALT DISNEY WORLD - INGRESSO 1 DIA EPCOT',
          qty: 3,
          date: '14/09/2026',
          passengers: [
            { name: 'Rodolpho Carvalho Costa da Rocha', birthDate: '07/11/1988' },
          ],
        },
      ],
      orderRef: '61293',
    });

    const out = await svc.extractVoucherText('org-1', { text: TEXTO_COLADO });

    expect(extractor.extract).toHaveBeenCalledWith(TEXTO_COLADO, 'org-1');
    expect(out.orderRef).toBe('61293');
    expect(out.items[0].passengers).toEqual([
      { name: 'Rodolpho Carvalho Costa da Rocha', birthDate: '07/11/1988' },
    ]);
  });

  // Texto em branco não paga token. O extrator já devolveria vazio, mas deixar
  // a chamada sair cobra uma ida ao LLM por campo vazio do atendente.
  it('não chama o LLM com texto vazio ou só espaços', async () => {
    const { svc, extractor } = build();

    for (const text of ['', '   ', '\n\t  \n']) {
      expect(await svc.extractVoucherText('org-1', { text })).toEqual({
        items: [],
        orderRef: null,
      });
    }
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  // Colar algo que não é voucher (uma conversa, um e-mail) tem que devolver
  // vazio, não itens inventados — o prompt manda devolver lista vazia e o
  // serviço não pode "melhorar" isso.
  it('texto que não é voucher devolve vazio, sem inventar item', async () => {
    const { svc } = build({ items: [], orderRef: null });

    const out = await svc.extractVoucherText('org-1', {
      text: 'oi, tudo bem? me manda o orçamento por favor',
    });

    expect(out).toEqual({ items: [], orderRef: null });
  });

  // O texto colado não toca no storage: não há arquivo, e é justamente a
  // conversão PDF→texto (a etapa frágil) que este caminho pula.
  it('não toca no storage nem na leitura de PDF', async () => {
    const { svc, storage } = build({ items: [{ description: 'X' }], orderRef: null });
    const readPdfText = jest.fn();
    (svc as any).readPdfText = readPdfText;

    await svc.extractVoucherText('org-1', { text: TEXTO_COLADO });

    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(readPdfText).not.toHaveBeenCalled();
  });
});
