import { Prisma } from '@prisma/client';
import { SupportTicketsService } from './support-tickets.service';

const NOW = new Date('2026-11-03T15:00:00Z');

const PIPELINE = {
  id: 'pipe-sup',
  stages: [
    { id: 'st-open', key: 'open' },
    { id: 'st-progress', key: 'in_progress' },
    { id: 'st-resolved', key: 'resolved' },
    { id: 'st-cancelled', key: 'cancelled' },
  ],
};

const CONVERSATION = {
  id: 'conv-1',
  organizationId: 'org-1',
  channelId: 'ch-1',
  contactId: 'contact-1',
  assignedToId: 'seller-pedro',
  contact: { name: 'Maria Souza', phone: '5511999990000' },
};

const INPUT = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  category: 'ingresso' as const,
  priority: 'alta' as const,
  summary: 'QR code do ingresso do Epic Universe não abre no app',
  customerQuote: 'o QR code do ingresso não abre',
  source: 'aline' as const,
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
}

function make(opts: { pipeline?: any; openCard?: any; maxNumber?: number | null } = {}) {
  const prisma = {
    pipeline: {
      findFirst: jest.fn().mockResolvedValue(opts.pipeline === undefined ? PIPELINE : opts.pipeline),
      create: jest.fn().mockResolvedValue({}),
    },
    conversation: { findUnique: jest.fn().mockResolvedValue(CONVERSATION) },
    card: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        where.stage ? Promise.resolve(opts.openCard ?? null) : Promise.resolve({ order: 4 }),
      ),
      aggregate: jest.fn().mockResolvedValue({ _max: { ticketNumber: opts.maxNumber === undefined ? 41 : opts.maxNumber } }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'card-new', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'card-old', ...data })),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'sys-1' }) },
  } as any;
  const realtime = { emitToOrg: jest.fn(), emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const sellerAlert = { onConversationAssigned: jest.fn().mockResolvedValue(undefined), onAiHandoff: jest.fn().mockResolvedValue(undefined), onSellerNote: jest.fn().mockResolvedValue(undefined), onSupportTicket: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new SupportTicketsService(prisma, realtime, sellerAlert);
  (svc as any).clock = () => NOW;
  return { svc, prisma, realtime, sellerAlert };
}

describe('SupportTicketsService.open', () => {
  it('abre o chamado no quadro Suporte com o próximo número, para o vendedor da conversa', async () => {
    const { svc, prisma, realtime } = make();

    const result = await svc.open(INPUT);

    expect(result).toEqual({ cardId: 'card-new', ticketNumber: '#S-0042', isNew: true });
    const { data } = prisma.card.create.mock.calls[0][0];
    expect(data).toMatchObject({
      organizationId: 'org-1',
      pipelineId: 'pipe-sup',
      stageId: 'st-open',
      ticketNumber: 42,
      title: '#S-0042 · Ingresso · Maria Souza',
      description: 'QR code do ingresso do Epic Universe não abre no app',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      assignedToId: 'seller-pedro',
      order: 5,
    });
    expect(data.metadata.supportTicket).toMatchObject({
      category: 'ingresso',
      priority: 'alta',
      source: 'aline',
      entries: [expect.objectContaining({ summary: INPUT.summary, customerQuote: INPUT.customerQuote })],
    });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org-1', 'card:created', expect.anything());
  });

  it('avisa a equipe dentro da conversa, sem mandar nada ao cliente', async () => {
    const { svc, prisma } = make();

    await svc.open(INPUT);

    const { data } = prisma.message.create.mock.calls[0][0];
    expect(data.type).toBe('SYSTEM');
    expect(data.content.text).toBe(
      '🎫 Chamado #S-0042 aberto (Ingresso, prioridade alta): QR code do ingresso do Epic Universe não abre no app',
    );
  });

  it('primeiro chamado da organização é o #S-0001', async () => {
    const { svc } = make({ maxNumber: null });

    expect((await svc.open(INPUT)).ticketNumber).toBe('#S-0001');
  });

  it('dois chamados ao mesmo tempo: quem perde o número tenta o seguinte', async () => {
    const { svc, prisma } = make();
    prisma.card.create.mockRejectedValueOnce(uniqueViolation());
    prisma.card.aggregate
      .mockResolvedValueOnce({ _max: { ticketNumber: 41 } })
      .mockResolvedValueOnce({ _max: { ticketNumber: 42 } });

    const result = await svc.open(INPUT);

    expect(result.ticketNumber).toBe('#S-0043');
    expect(prisma.card.create).toHaveBeenCalledTimes(2);
  });

  it('urgente ganha 🚨 no título', async () => {
    const { svc, prisma } = make();

    await svc.open({ ...INPUT, priority: 'urgente' });

    expect(prisma.card.create.mock.calls[0][0].data.title).toBe('🚨 #S-0042 · Ingresso · Maria Souza');
  });

  it('chamado aberto na conversa: anexa a novidade nele em vez de abrir outro', async () => {
    const openCard = {
      id: 'card-old',
      title: '#S-0007 · Ingresso · Maria Souza',
      description: 'QR code não abre',
      ticketNumber: 7,
      metadata: {
        supportTicket: { category: 'ingresso', priority: 'normal', source: 'aline', entries: [{ summary: 'QR code não abre' }] },
      },
    };
    const { svc, prisma, realtime } = make({ openCard });

    const result = await svc.open({ ...INPUT, category: 'transfer', priority: 'urgente', summary: 'transfer não apareceu no aeroporto' });

    expect(result).toEqual({ cardId: 'card-old', ticketNumber: '#S-0007', isNew: false });
    expect(prisma.card.create).not.toHaveBeenCalled();
    const { where, data } = prisma.card.update.mock.calls[0][0];
    expect(where).toEqual({ id: 'card-old' });
    expect(data.title).toBe('🚨 #S-0007 · Ingresso · Maria Souza');
    expect(data.description).toContain('QR code não abre');
    expect(data.description).toContain('transfer não apareceu no aeroporto');
    expect(data.metadata.supportTicket.priority).toBe('urgente');
    expect(data.metadata.supportTicket.entries).toHaveLength(2);
    expect(openCard.metadata.supportTicket.entries).toHaveLength(1);
    expect(prisma.message.create.mock.calls[0][0].data.content.text).toBe(
      '🎫 Chamado #S-0007 atualizado (Transfer, prioridade urgente): transfer não apareceu no aeroporto',
    );
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org-1', 'card:updated', expect.anything());
  });

  it('procura chamado aberto só fora das etapas Resolvido e Cancelado', async () => {
    const { svc, prisma } = make();

    await svc.open(INPUT);

    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          pipelineId: 'pipe-sup',
          conversationId: 'conv-1',
          status: 'OPEN',
          ticketNumber: { not: null },
          stage: { OR: [{ key: null }, { key: { notIn: ['resolved', 'cancelled'] } }] },
        },
      }),
    );
  });

  it('primeiro chamado da organização cria o quadro Suporte com as etapas', async () => {
    const { svc, prisma } = make();
    prisma.pipeline.findFirst.mockResolvedValueOnce(null).mockResolvedValue(PIPELINE);

    await svc.open(INPUT);

    const { data } = prisma.pipeline.create.mock.calls[0][0];
    expect(data).toMatchObject({ organizationId: 'org-1', key: 'support', name: 'Suporte' });
    expect(data.stages.create.map((s: any) => s.name)).toEqual([
      'Aberto',
      'Em atendimento',
      'Aguardando cliente',
      'Resolvido',
      'Cancelado',
    ]);
    expect(data.stages.create.every((s: any) => s.type === 'NORMAL')).toBe(true);
  });

  it('conversa de outra organização: recusa', async () => {
    const { svc, prisma } = make();
    prisma.conversation.findUnique.mockResolvedValue({ ...CONVERSATION, organizationId: 'org-2' });

    await expect(svc.open(INPUT)).rejects.toThrow('Conversa não encontrada');
  });

  it('chamado NOVO avisa o vendedor da conversa', async () => {
    const { svc, sellerAlert } = make({ maxNumber: 41 });
    await svc.open(INPUT);
    expect(sellerAlert.onSupportTicket).toHaveBeenCalledWith('conv-1', '#S-0042');
  });
});
