import { CoexistenceHistoryService } from './coexistence-history.service';
import { MessageContentType } from './ports/types';

describe('CoexistenceHistoryService', () => {
  function make() {
    const job = { id: 'job1' };
    const prisma = {
      channelSyncJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(job),
        update: jest.fn().mockResolvedValue(job),
      },
    } as any;
    const notifications = { notifyOrgAgents: jest.fn().mockResolvedValue(undefined) } as any;
    const historyImport = {
      importConversation: jest.fn().mockResolvedValue({ conversationId: 'conv1', contactId: 'c1', isNew: true }),
      importMessages: jest.fn().mockResolvedValue({ imported: 2, skipped: 0 }),
    } as any;
    const channel = { id: 'ch1', name: 'Comercial', organizationId: 'org1' } as any;
    return {
      svc: new CoexistenceHistoryService(prisma, notifications, historyImport),
      prisma, notifications, historyImport, channel,
    };
  }

  const msg = (id: string, fromBusiness: boolean) => ({
    externalId: id,
    fromBusiness,
    timestamp: new Date('2026-07-01T10:00:00Z'),
    type: MessageContentType.TEXT,
    content: { text: 'oi' },
  });

  it('importa pelo caminho SILENCIOSO — nunca pela fila inbound', async () => {
    const { svc, historyImport, channel } = make();
    await svc.handleChunk(channel, {
      phase: 'PHASE_1', chunkOrder: 0, progress: 50,
      threads: [{ contactPhone: '5511999', messages: [msg('m1', false), msg('m2', true)] }],
    });
    // O HistoryImportService grava via createMany, sem IA/cadência/notificação.
    expect(historyImport.importConversation).toHaveBeenCalled();
    expect(historyImport.importMessages).toHaveBeenCalled();
  });

  it('mensagem do NEGOCIO vira OUTBOUND e do cliente vira INBOUND', async () => {
    const { svc, historyImport, channel } = make();
    await svc.handleChunk(channel, {
      threads: [{ contactPhone: '5511999', messages: [msg('m1', false), msg('m2', true)] }],
    });
    const sent = historyImport.importMessages.mock.calls[0][2];
    expect(sent[0].direction).toBe('INBOUND');
    expect(sent[1].direction).toBe('OUTBOUND');
  });

  it('progresso < 100 mantem RUNNING; == 100 conclui e avisa', async () => {
    const { svc, prisma, notifications, channel } = make();
    await svc.handleChunk(channel, { progress: 40, threads: [] });
    expect(prisma.channelSyncJob.update.mock.calls[0][0].data.status).toBe('RUNNING');
    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();

    await svc.handleChunk(channel, { progress: 100, threads: [] });
    expect(prisma.channelSyncJob.update.mock.calls[1][0].data.status).toBe('COMPLETED');
    expect(notifications.notifyOrgAgents).toHaveBeenCalled();
  });

  // O relogio de 24h esta correndo — uma thread ruim nao pode abortar o resto.
  it('thread que falha nao derruba o pedaco inteiro', async () => {
    const { svc, historyImport, channel } = make();
    historyImport.importConversation
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ conversationId: 'conv2', contactId: 'c2', isNew: true });

    await expect(
      svc.handleChunk(channel, {
        threads: [
          { contactPhone: '5511111', messages: [msg('m1', false)] },
          { contactPhone: '5522222', messages: [msg('m2', false)] },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(historyImport.importConversation).toHaveBeenCalledTimes(2);
  });

  it('cliente que desligou o sync no app (2593109) marca FAILED e explica', async () => {
    const { svc, prisma, notifications, channel } = make();
    await svc.handleChunk(channel, { threads: [], error: { code: 2593109, message: 'off' } });
    expect(prisma.channelSyncJob.update.mock.calls[0][0].data.status).toBe('FAILED');
    const body = notifications.notifyOrgAgents.mock.calls[0][0].body;
    expect(body).toMatch(/desativou o compartilhamento/i);
  });

  it('reaproveita job em andamento em vez de criar um por pedaco', async () => {
    const { svc, prisma, channel } = make();
    prisma.channelSyncJob.findFirst.mockResolvedValue({ id: 'existente' });
    await svc.handleChunk(channel, { progress: 10, threads: [] });
    expect(prisma.channelSyncJob.create).not.toHaveBeenCalled();
    expect(prisma.channelSyncJob.update.mock.calls[0][0].where.id).toBe('existente');
  });
});
