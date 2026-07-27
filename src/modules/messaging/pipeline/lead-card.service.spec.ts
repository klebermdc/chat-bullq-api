import { LeadCardService } from './lead-card.service';

const PARAMS = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
};

function make(overrides: { stages?: { id: string; name: string }[] | null } = {}) {
  const stages =
    overrides.stages === undefined
      ? [
          { id: 'stage-lead', name: 'Lead' },
          { id: 'stage-dist', name: 'Distribuir' },
        ]
      : overrides.stages;

  const prisma = {
    card: {
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 4 } }),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'card-1', ...data }),
      ),
    },
    pipeline: {
      findFirst: jest
        .fn()
        .mockResolvedValue(stages === null ? null : { id: 'pipe-1', stages }),
    },
    contact: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ name: 'Fulano', phone: '5511999' }),
    },
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;

  return { service: new LeadCardService(prisma, realtime), prisma, realtime };
}

describe('LeadCardService.ensureLeadCard', () => {
  it('cria o card na etapa "Lead" do funil de vendas', async () => {
    const { service, prisma, realtime } = make();

    const cardId = await service.ensureLeadCard(PARAMS);

    expect(cardId).toBe('card-1');
    expect(prisma.card.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-lead',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        title: 'Fulano',
        order: 5, // fim da coluna
      }),
    });
    expect(realtime.emitToOrg).toHaveBeenCalledWith(
      'org-1',
      'card:created',
      expect.objectContaining({ card: expect.objectContaining({ id: 'card-1' }) }),
    );
  });

  it('filtra o card existente por organizationId (isolamento por tenant)', async () => {
    const { service, prisma } = make();
    await service.ensureLeadCard(PARAMS);
    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', conversationId: 'conv-1' },
      }),
    );
  });

  it('NÃO mexe quando a conversa já tem card (nunca puxa de volta pra Lead)', async () => {
    const { service, prisma, realtime } = make();
    prisma.card.findFirst.mockResolvedValue({ id: 'card-existente' });

    const cardId = await service.ensureLeadCard(PARAMS);

    expect(cardId).toBeNull();
    expect(prisma.card.create).not.toHaveBeenCalled();
    expect(realtime.emitToOrg).not.toHaveBeenCalled();
  });

  it('cai na primeira etapa quando não existe etapa com "lead" no nome', async () => {
    const { service, prisma } = make({
      stages: [
        { id: 'stage-dist', name: 'Distribuir' },
        { id: 'stage-col', name: 'Coletando Informação' },
      ],
    });

    await service.ensureLeadCard(PARAMS);

    expect(prisma.card.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ stageId: 'stage-dist' }),
    });
  });

  it('no-op silencioso quando a org não tem funil de vendas', async () => {
    const { service, prisma } = make({ stages: null });

    const cardId = await service.ensureLeadCard(PARAMS);

    expect(cardId).toBeNull();
    expect(prisma.card.create).not.toHaveBeenCalled();
  });

  it('no-op quando o funil está sem etapas', async () => {
    const { service, prisma } = make({ stages: [] });

    const cardId = await service.ensureLeadCard(PARAMS);

    expect(cardId).toBeNull();
    expect(prisma.card.create).not.toHaveBeenCalled();
  });

  it('usa o telefone como título quando o contato não tem nome', async () => {
    const { service, prisma } = make();
    prisma.contact.findUnique.mockResolvedValue({ name: null, phone: '5511999' });

    await service.ensureLeadCard(PARAMS);

    expect(prisma.card.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: '5511999' }),
    });
  });

  it('engole erro de banco (inbound nunca cai por causa do Kanban)', async () => {
    const { service, prisma } = make();
    prisma.card.create.mockRejectedValue(new Error('deadlock'));

    await expect(service.ensureLeadCard(PARAMS)).resolves.toBeNull();
  });
});
