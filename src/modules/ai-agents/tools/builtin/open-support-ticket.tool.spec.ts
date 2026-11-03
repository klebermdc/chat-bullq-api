import { OpenSupportTicketTool } from './open-support-ticket.tool';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-aline',
  runId: 'run-1',
};

const INPUT = {
  category: 'ingresso',
  priority: 'alta',
  summary: 'QR code do ingresso do Epic Universe não abre no app',
  customerQuote: 'o QR code do ingresso não abre',
};

function make(opts: { texts?: string[]; ticket?: any; sockets?: any[] } = {}) {
  const prisma = {
    message: {
      findMany: jest.fn().mockResolvedValue(
        (opts.texts ?? ['Oi! Comprei com vocês e o QR code do ingresso não abre de jeito nenhum']).map((text) => ({
          content: { text },
          metadata: null,
        })),
      ),
    },
  } as any;
  const tickets = {
    open: jest.fn().mockResolvedValue(opts.ticket ?? { cardId: 'card-1', ticketNumber: '#S-0042', isNew: true }),
  } as any;
  const realtime = { listSocketPresence: jest.fn().mockResolvedValue(opts.sockets ?? []) } as any;
  return { tool: new OpenSupportTicketTool(prisma, tickets, realtime), tickets, realtime };
}

describe('OpenSupportTicketTool', () => {
  it('abre o chamado e devolve o número para a Aline passar ao cliente', async () => {
    const { tool, tickets } = make();

    const result = await tool.execute(INPUT, CTX);

    expect(tickets.open).toHaveBeenCalledWith({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      category: 'ingresso',
      priority: 'alta',
      summary: INPUT.summary,
      customerQuote: INPUT.customerQuote,
      source: 'aline',
    });
    expect(result.output).toEqual({
      ok: true,
      ticketNumber: '#S-0042',
      isNew: true,
      message: expect.stringContaining('#S-0042'),
    });
    expect(result.finalAction).toBeUndefined();
  });

  it('chamado já aberto na conversa: diz que foi atualizado', async () => {
    const { tool } = make({ ticket: { cardId: 'card-1', ticketNumber: '#S-0007', isNew: false } });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: true, ticketNumber: '#S-0007', isNew: false });
    expect((result.output as any).message).toContain('atualizado');
  });

  it('alguém da equipe online: não abre chamado', async () => {
    const { tool, tickets } = make({
      sockets: [{ organizationId: 'org-1', userId: 'u-1', lastActiveAt: new Date() }],
    });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'team_online' });
    expect(tickets.open).not.toHaveBeenCalled();
  });

  it('Chat aberto e parado há mais de 5 min, ou online em outra org, não conta', async () => {
    const { tool, tickets } = make({
      sockets: [
        { organizationId: 'org-1', userId: 'u-1', lastActiveAt: new Date(Date.now() - 30 * 60_000) },
        { organizationId: 'org-2', userId: 'u-9', lastActiveAt: new Date() },
      ],
    });

    await tool.execute(INPUT, CTX);

    expect(tickets.open).toHaveBeenCalled();
  });

  it('não abre chamado com frase que o cliente não escreveu', async () => {
    const { tool, tickets } = make({ texts: ['quanto custa o ingresso do Epic Universe?'] });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'quote_not_found' });
    expect(tickets.open).not.toHaveBeenCalled();
  });

  it('recusa categoria ou prioridade fora da lista e resumo vazio', async () => {
    const { tool, tickets } = make();

    const results = await Promise.all([
      tool.execute({ ...INPUT, category: 'cotação' }, CTX),
      tool.execute({ ...INPUT, priority: 'altíssima' }, CTX),
      tool.execute({ ...INPUT, summary: '  ' }, CTX),
    ]);

    for (const r of results) expect(r.output).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(tickets.open).not.toHaveBeenCalled();
  });
});
