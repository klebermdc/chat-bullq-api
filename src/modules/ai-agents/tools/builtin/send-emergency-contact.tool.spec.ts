import { SendEmergencyContactTool } from './send-emergency-contact.tool';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-aline',
  runId: 'run-1',
};

const NOW = new Date('2026-11-03T23:30:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const CUSTOMER_MESSAGES = [
  { content: { text: 'boa noite' }, metadata: null },
  {
    content: { text: 'Já estou em Orlando, aqui na porta do Magic Kingdom, e o ingresso não passa na catraca' },
    metadata: null,
  },
];

const INPUT = {
  location: 'Orlando, na entrada do Magic Kingdom',
  tripQuote: 'já estou em Orlando, aqui na porta do Magic Kingdom',
  urgencyQuote: 'o ingresso não passa na catraca',
  problemCategory: 'ingresso',
  problem: 'ingresso não passa na catraca do Magic Kingdom',
};

function make(opts: { sockets?: any[]; alreadySent?: boolean; inbound?: any[] } = {}) {
  const prisma = {
    message: {
      findFirst: jest.fn().mockResolvedValue(opts.alreadySent ? { id: 'old' } : null),
      findMany: jest.fn().mockResolvedValue(opts.inbound ?? CUSTOMER_MESSAGES),
      create: jest.fn().mockResolvedValue({ id: 'note-1' }),
    },
    contact: { findUnique: jest.fn().mockResolvedValue({ name: 'Maria Souza' }) },
  } as any;
  const realtime = {
    listSocketPresence: jest.fn().mockResolvedValue(opts.sockets ?? []),
    emitToChannel: jest.fn(),
    emitToConversation: jest.fn(),
  } as any;
  const reply = {
    deliver: jest.fn().mockResolvedValue({ output: { ok: true, messageId: 'msg-1' }, finalAction: 'REPLIED' }),
  } as any;
  const tool = new SendEmergencyContactTool(prisma, realtime, reply);
  (tool as any).clock = () => NOW;
  return { tool, prisma, realtime, reply };
}

const notes = (prisma: any) =>
  prisma.message.create.mock.calls.map((c: any) => c[0].data).filter((d: any) => d.type === 'SYSTEM');

describe('SendEmergencyContactTool', () => {
  it('equipe offline e cliente no destino com urgência: manda o link do WhatsApp de emergência', async () => {
    const { tool, prisma, reply } = make();

    const result = await tool.execute(INPUT, CTX);

    expect(result).toEqual({ output: { ok: true, sent: true }, finalAction: 'REPLIED' });
    const [text, ctx, metadata] = reply.deliver.mock.calls[0];
    expect(text).toContain('(11) 5194-1724');
    expect(text).toContain('https://wa.me/551151941724?text=');
    expect(decodeURIComponent(text)).toContain('Sou Maria Souza');
    expect(ctx).toBe(CTX);
    expect(metadata).toEqual({ emergencyContact: true });

    const [note] = notes(prisma);
    expect(note.content.text).toContain('🚨');
    expect(note.content.text).toContain('Orlando, na entrada do Magic Kingdom');
    expect(note.content.text).toContain('ingresso não passa na catraca do Magic Kingdom');
  });

  it('procura as provas só nas mensagens do cliente das últimas 48h', async () => {
    const { tool, prisma } = make();

    await tool.execute(INPUT, CTX);

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'conv-1',
          direction: 'INBOUND',
          createdAt: { gte: new Date(NOW.getTime() - 48 * 3600_000) },
        },
      }),
    );
  });

  it('não manda o número se o cliente não escreveu que já está em viagem', async () => {
    const { tool, reply } = make({
      inbound: [{ content: { text: 'vou para Orlando mês que vem, o ingresso não passa na catraca?' }, metadata: null }],
    });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'trip_not_confirmed' });
    expect(reply.deliver).not.toHaveBeenCalled();
  });

  it('não manda o número se a urgência não está nas palavras do cliente', async () => {
    const { tool, reply } = make();

    const result = await tool.execute({ ...INPUT, urgencyQuote: 'perdi meu passaporte no parque' }, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'urgency_not_confirmed' });
    expect(reply.deliver).not.toHaveBeenCalled();
  });

  it('aceita a prova vinda de áudio transcrito', async () => {
    const { tool, reply } = make({
      inbound: [
        {
          content: { mediaUrl: 'x' },
          metadata: {
            transcription: {
              text: 'Já estou em Orlando, aqui na porta do Magic Kingdom, e o ingresso não passa na catraca',
            },
          },
        },
      ],
    });

    await tool.execute(INPUT, CTX);

    expect(reply.deliver).toHaveBeenCalled();
  });

  it('alguém da equipe online: não passa o número e deixa o alerta na conversa', async () => {
    const { tool, prisma, reply } = make({
      sockets: [{ organizationId: 'org-1', userId: 'u-1', lastActiveAt: minutesAgo(2) }],
    });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'team_online' });
    expect(reply.deliver).not.toHaveBeenCalled();
    const [note] = notes(prisma);
    expect(note.content.text).toContain('🚨');
    expect(note.content.text).toContain('equipe online');
  });

  it('Chat aberto e parado há mais de 5 min não conta como online', async () => {
    const { tool, reply } = make({
      sockets: [{ organizationId: 'org-1', userId: 'u-1', lastActiveAt: minutesAgo(30) }],
    });

    await tool.execute(INPUT, CTX);

    expect(reply.deliver).toHaveBeenCalled();
  });

  it('atendente online em outra organização não conta', async () => {
    const { tool, reply } = make({
      sockets: [{ organizationId: 'org-2', userId: 'u-9', lastActiveAt: minutesAgo(1) }],
    });

    await tool.execute(INPUT, CTX);

    expect(reply.deliver).toHaveBeenCalled();
  });

  it('sem conseguir ler a presença, trata a equipe como offline para não deixar o passageiro sem saída', async () => {
    const { tool, realtime, reply } = make();
    realtime.listSocketPresence.mockRejectedValue(new Error('redis caiu'));

    await tool.execute(INPUT, CTX);

    expect(reply.deliver).toHaveBeenCalled();
  });

  it('já mandou o contato nas últimas 24h: não repete', async () => {
    const { tool, prisma, reply } = make({ alreadySent: true });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'already_sent' });
    expect(reply.deliver).not.toHaveBeenCalled();
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId: 'conv-1',
          createdAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) },
          metadata: { path: ['emergencyContact'], equals: true },
          status: { not: 'FAILED' },
        },
      }),
    );
  });

  it('recusa categoria fora da lista ou problema vazio', async () => {
    const { tool, reply } = make();

    const bad = await tool.execute({ ...INPUT, problemCategory: 'cotação' }, CTX);
    const empty = await tool.execute({ ...INPUT, problem: '  ' }, CTX);

    expect(bad.output).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(empty.output).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(reply.deliver).not.toHaveBeenCalled();
  });

  it('link já enviado e alerta interno falhando: ainda conta como enviado, sem repetir', async () => {
    const { tool, prisma } = make();
    prisma.message.create.mockRejectedValue(new Error('db fora'));

    const result = await tool.execute(INPUT, CTX);

    expect(result).toEqual({ output: { ok: true, sent: true }, finalAction: 'REPLIED' });
  });

  it('se o envio falhar, devolve o erro e não registra que mandou', async () => {
    const { tool, prisma, reply } = make();
    reply.deliver.mockResolvedValue({ output: { ok: false, error: 'Contact has no external id on this channel' } });

    const result = await tool.execute(INPUT, CTX);

    expect(result.output).toMatchObject({ ok: false });
    expect(result.finalAction).toBeUndefined();
    expect(notes(prisma)).toHaveLength(0);
  });
});
