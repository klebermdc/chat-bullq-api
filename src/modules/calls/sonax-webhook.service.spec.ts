import { SonaxWebhookService } from './sonax-webhook.service';

function makeDeps(over: any = {}) {
  const state = {
    settings: over.settings ?? { organizationId: 'org1', webhookSecret: 'secretA' },
    call: over.call ?? { id: 'call1', organizationId: 'org1', conversationId: 'conv1', messageId: 'msg1', status: 'DIALING' },
  };
  const updated: any = {};
  const prisma = {
    sonaxSettings: { findFirst: jest.fn(async ({ where }) => (where.webhookSecret === state.settings.webhookSecret ? state.settings : null)) },
    call: {
      findUnique: jest.fn(async () => state.call),
      update: jest.fn(async ({ data }) => { updated.call = data; return { ...state.call, ...data }; }),
    },
    message: { update: jest.fn(async ({ data }) => { updated.message = data; return data; }) },
  } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  const insightQueue = { add: jest.fn(async () => ({})) } as any;
  return { prisma, realtime, insightQueue, updated, svc: new SonaxWebhookService(prisma, realtime, insightQueue) };
}

describe('SonaxWebhookService.apply', () => {
  const q = { var_1: 'call1', status: 'desligada', status_atend: 'S', duracao: '192', url_gravacao: 'https://rec/x' };

  it('enfileira o resumo quando atendida (S) + tem gravação', async () => {
    const d = makeDeps();
    await d.svc.apply('secretA', q);
    expect(d.insightQueue.add).toHaveBeenCalledWith('insight', { callId: 'call1' }, expect.any(Object));
  });

  it('NÃO enfileira quando não atendida (status_atend=N)', async () => {
    const d = makeDeps();
    await d.svc.apply('secretA', { ...q, status_atend: 'N', status: 'indisponivel' });
    expect(d.insightQueue.add).not.toHaveBeenCalled();
  });

  it('atualiza Call e Message quando secret e org batem', async () => {
    const d = makeDeps();
    await d.svc.apply('secretA', q);
    expect(d.updated.call.status).toBe('FINISHED');
    expect(d.updated.call.durationSec).toBe(192);
    expect(d.updated.call.recordingUrl).toBe('https://rec/x');
    expect(d.updated.message.content.status).toBe('FINISHED');
    expect(d.realtime.emitToConversation).toHaveBeenCalled();
  });

  it('secret inválido => lança (nunca deixa passar)', async () => {
    const d = makeDeps();
    await expect(d.svc.apply('secretERRADO', q)).rejects.toBeTruthy();
  });

  it('rejeita cross-tenant: Call de outra org não é tocado', async () => {
    const d = makeDeps({ call: { id: 'call1', organizationId: 'orgOUTRA', conversationId: 'c', messageId: 'm', status: 'DIALING' } });
    await expect(d.svc.apply('secretA', q)).rejects.toBeTruthy();
    expect(d.prisma.call.update).not.toHaveBeenCalled();
  });

  it('idempotente: Call já FINISHED não reprocessa nem duplica', async () => {
    const d = makeDeps({ call: { id: 'call1', organizationId: 'org1', conversationId: 'conv1', messageId: 'msg1', status: 'FINISHED' } });
    const res = await d.svc.apply('secretA', q);
    expect(res.skipped).toBe(true);
    expect(d.prisma.call.update).not.toHaveBeenCalled();
  });
});
