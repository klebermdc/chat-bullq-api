import { NotFoundException } from '@nestjs/common';
import { formatTranscript, SellerCallRecordService } from './seller-call-record.service';

const CONV = { id: 'cv1', channelId: 'ch1', contactId: 'c1' };

function make(opts: { call?: any; summarize?: jest.Mock } = {}) {
  const base = { id: 'call1', organizationId: 'org1', conversationId: 'cv1', messageId: 'm1', status: 'DIALING', answered: false, durationSec: null, insightState: 'PENDING', insight: null, endedAt: null };
  let row: any = opts.call === undefined ? { ...base } : opts.call;
  const prisma = {
    call: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ ...base, ...data, messageId: null })),
      findFirst: jest.fn().mockImplementation(async () => row),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        row = { ...row, ...data };
        return row;
      }),
    },
    message: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'm1', ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const insight = { summarize: opts.summarize ?? jest.fn().mockResolvedValue({ summary: 'Cliente quer fechar', nextSteps: ['Enviar link'], sentiment: 'positivo' }) } as any;
  const flush = () => new Promise((r) => setImmediate(r));
  return { svc: new SellerCallRecordService(prisma, realtime, insight), prisma, realtime, insight, flush };
}

describe('formatTranscript', () => {
  it('uma linha por fala com quem falou', () => {
    expect(formatTranscript([{ quem: 'cliente', texto: 'Oi' }, { quem: 'vendedor', texto: 'Olá!' }])).toBe('Cliente: Oi\nVendedor: Olá!');
  });
});

describe('SellerCallRecordService.open', () => {
  it('grava a ligação (ramal whatsapp) e põe o cartão na conversa', async () => {
    const { svc, prisma, realtime } = make();
    const id = await svc.open({ organizationId: 'org1', conversation: CONV, agentId: 'renata', numero: '5511999990000' });
    expect(id).toBe('call1');
    expect(prisma.call.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ramal: 'whatsapp', status: 'DIALING', insightState: null, agentId: 'renata', conversationId: 'cv1' }) });
    expect(prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'SYSTEM', senderId: 'renata', content: expect.objectContaining({ kind: 'call', via: 'whatsapp', callId: 'call1' }) }) });
    expect(prisma.call.update).toHaveBeenCalledWith({ where: { id: 'call1' }, data: { messageId: 'm1' } });
    expect(realtime.emitToConversation).toHaveBeenCalledWith('cv1', 'message:new', expect.anything());
  });
});

describe('SellerCallRecordService.finish', () => {
  const answered = { callId: 'call1', answered: true, durationSec: 95, segments: [{ quem: 'cliente' as const, texto: 'Vi sim' }, { quem: 'vendedor' as const, texto: 'Ótimo' }] };

  it('atendida: grava a transcrição, responde na hora e depois põe o resumo no cartão', async () => {
    const { svc, prisma, insight, realtime, flush } = make();
    await expect(svc.finish(answered)).resolves.toEqual({ ok: true });
    expect(prisma.call.update).toHaveBeenCalledWith({
      where: { id: 'call1' },
      data: expect.objectContaining({ status: 'FINISHED', answered: true, durationSec: 95, transcript: 'Cliente: Vi sim\nVendedor: Ótimo', insightState: 'PENDING' }),
    });
    await flush();
    expect(insight.summarize).toHaveBeenCalledWith('org1', 'Cliente: Vi sim\nVendedor: Ótimo');
    expect(realtime.emitToConversation).toHaveBeenCalledWith('cv1', 'call:insight', expect.objectContaining({ callId: 'call1', insightState: 'READY' }));
    expect(realtime.emitToConversation).toHaveBeenLastCalledWith('cv1', 'message:update', {
      messageId: 'm1',
      content: expect.objectContaining({ insightState: 'READY', insight: expect.objectContaining({ summary: 'Cliente quer fechar' }), hasTranscript: true }),
    });
  });

  it('não atendida: sem resumo', async () => {
    const { svc, prisma, insight, flush } = make();
    await svc.finish({ callId: 'call1', answered: false, durationSec: 0, segments: [] });
    await flush();
    expect(prisma.call.update).toHaveBeenCalledWith({ where: { id: 'call1' }, data: expect.objectContaining({ status: 'NO_ANSWER', insightState: 'SKIPPED' }) });
    expect(insight.summarize).not.toHaveBeenCalled();
  });

  it('resumo falhou: mantém a transcrição e marca FAILED', async () => {
    const { svc, prisma, flush } = make({ summarize: jest.fn().mockRejectedValue(new Error('sem chave de IA')) });
    await svc.finish(answered);
    await flush();
    expect(prisma.call.update).toHaveBeenLastCalledWith({ where: { id: 'call1' }, data: { insightState: 'FAILED' } });
  });

  it('ligação já encerrada ou que falhou não é reescrita; inexistente dá 404', async () => {
    const encerrada = make({ call: { id: 'call1', status: 'FAILED', endedAt: new Date() } });
    await encerrada.svc.finish(answered);
    expect(encerrada.prisma.call.update).not.toHaveBeenCalled();
    await expect(make({ call: null }).svc.finish(answered)).rejects.toBeInstanceOf(NotFoundException);
  });
});
