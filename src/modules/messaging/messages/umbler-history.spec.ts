import { ForbiddenException } from '@nestjs/common';
import { UmblerHistoryService } from './umbler-history.service';

const ORG = 'org-1';
const CONV = 'conv-1';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  conversa_id: 'u1',
  enviada_em: new Date('2025-03-10T12:00:00Z'),
  origem: 'Contact',
  tipo: 'Text',
  conteudo: 'Oi, quero cotar Orlando',
  autor: null,
  arquivo_url: null,
  arquivo_nome: null,
  arquivo_tipo: null,
  privada: false,
  canal_nome: 'Orlando Fast Pass - API',
  setor_nome: 'OFP',
  contato_nome: 'Osmar',
  criada_em: new Date('2025-03-10T11:59:00Z'),
  etiquetas: ['Renata'],
  atendentes: ['Renata Souza'],
  ...over,
});

function build(phone: string | null, rows: unknown[] = []) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const contactHistory = {
    resolveEntryContact: jest.fn().mockResolvedValue({ id: 'c1', phone }),
  };
  const service = new UmblerHistoryService(prisma as any, contactHistory as any);
  return { service, prisma, contactHistory };
}

/** Os parâmetros interpolados na consulta (Prisma.sql guarda em `values`). */
const params = (prisma: { $queryRaw: jest.Mock }) => prisma.$queryRaw.mock.calls[0][0].values;

describe('UmblerHistoryService.availability', () => {
  it('sem telefone no contato não consulta e devolve vazio', async () => {
    const { service, prisma } = build(null);

    const out = await service.availability(CONV, ORG, 'ALL');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out).toEqual({ conversations: 0, messages: 0, oldestAt: null, newestAt: null });
  });

  it('procura pela org e por todas as formas do telefone (com e sem 9º dígito)', async () => {
    const { service, prisma } = build('5554999442103', [
      { conversations: 2, messages: 40, oldest: new Date('2025-01-02T00:00:00Z'), newest: new Date('2026-10-20T00:00:00Z') },
    ]);

    const out = await service.availability(CONV, ORG, 'ALL');

    const values = params(prisma);
    expect(values).toContain(ORG);
    const variants = values.find((v: unknown) => Array.isArray(v));
    expect(variants).toEqual(expect.arrayContaining(['5554999442103', '555499442103']));
    expect(out).toEqual({
      conversations: 2,
      messages: 40,
      oldestAt: new Date('2025-01-02T00:00:00Z'),
      newestAt: new Date('2026-10-20T00:00:00Z'),
    });
  });

  it('herda a checagem de acesso da conversa de entrada', async () => {
    const { service, contactHistory, prisma } = build('5554999442103');
    contactHistory.resolveEntryContact.mockRejectedValue(new ForbiddenException());

    await expect(service.availability(CONV, ORG, 'ALL', 'u-agent', 'AGENT' as any)).rejects.toThrow(
      ForbiddenException,
    );
    expect(contactHistory.resolveEntryContact).toHaveBeenCalledWith(CONV, ORG, 'ALL', 'u-agent', 'AGENT');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('UmblerHistoryService.findOlder', () => {
  it('devolve a página em ordem cronológica, com as conversas resumidas', async () => {
    const newer = row({ id: 'm2', enviada_em: new Date('2025-03-10T12:05:00Z'), origem: 'Member', autor: 'Renata Souza' });
    const older = row();
    const { service } = build('5554999442103', [newer, older]);

    const out = await service.findOlder(CONV, ORG, { limit: 50 }, 'ALL');

    expect(out.hasMore).toBe(false);
    expect(out.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(out.messages[1]).toEqual({
      id: 'm2',
      conversationId: 'u1',
      sentAt: new Date('2025-03-10T12:05:00Z'),
      origin: 'Member',
      type: 'Text',
      text: 'Oi, quero cotar Orlando',
      author: 'Renata Souza',
      file: null,
      isPrivate: false,
    });
    expect(out.conversations).toEqual({
      u1: {
        channelName: 'Orlando Fast Pass - API',
        sectorName: 'OFP',
        contactName: 'Osmar',
        startedAt: new Date('2025-03-10T11:59:00Z'),
        tags: ['Renata'],
        attendants: ['Renata Souza'],
      },
    });
  });

  it('pede uma a mais que o limite para saber se há mais antigas', async () => {
    const rows = [row({ id: 'm3' }), row({ id: 'm2' }), row({ id: 'm1' })];
    const { service, prisma } = build('5554999442103', rows);

    const out = await service.findOlder(CONV, ORG, { limit: 2 }, 'ALL');

    expect(params(prisma)).toContain(3);
    expect(out.hasMore).toBe(true);
    expect(out.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('usa o cursor (data + id) da mensagem mais antiga já carregada', async () => {
    const { service, prisma } = build('5554999442103', []);
    const beforeAt = new Date('2025-03-10T12:00:00Z');

    await service.findOlder(CONV, ORG, { limit: 50, beforeAt, beforeId: 'm1' }, 'ALL');

    const values = params(prisma);
    expect(values).toContain('m1');
    expect(values).toContainEqual(beforeAt);
  });

  it('anexo vira objeto file com url, nome e tipo', async () => {
    const { service } = build('5554999442103', [
      row({ tipo: 'File', arquivo_url: 'https://s3/x.pdf', arquivo_nome: 'Roteiro.pdf', arquivo_tipo: 'application/pdf' }),
    ]);

    const out = await service.findOlder(CONV, ORG, { limit: 50 }, 'ALL');

    expect(out.messages[0].file).toEqual({ url: 'https://s3/x.pdf', name: 'Roteiro.pdf', mimeType: 'application/pdf' });
  });

  it('sem telefone no contato devolve página vazia sem consultar', async () => {
    const { service, prisma } = build(null);

    const out = await service.findOlder(CONV, ORG, { limit: 50 }, 'ALL');

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out).toEqual({ messages: [], hasMore: false, conversations: {} });
  });
});
