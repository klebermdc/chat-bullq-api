import { CallInsightProcessor } from './call-insight.processor';

function makeDeps(over: any = {}) {
  const state = {
    call: over.call ?? {
      id: 'call1',
      organizationId: 'org1',
      conversationId: 'conv1',
      messageId: 'msg1',
      status: 'FINISHED',
      answered: true,
      durationSec: 120,
      recordingUrl: 'https://rec/x',
      insightState: 'PENDING',
    },
  };
  const updates: any[] = [];
  const prisma = {
    call: {
      findUnique: jest.fn(async () => state.call),
      update: jest.fn(async ({ data }) => { updates.push(data); return { ...state.call, ...data }; }),
    },
    message: { update: jest.fn(async () => ({})) },
  } as any;
  const downloader = { download: over.download ?? jest.fn(async () => ({ buffer: new ArrayBuffer(5000), mimeType: 'audio/mpeg' })) } as any;
  const transcription = { transcribeBuffer: jest.fn(async () => ({ text: 'olá tudo bem', provider: 'groq-whisper', transcribedAt: 'now' })) } as any;
  const insight = { summarize: over.summarize ?? jest.fn(async () => ({ summary: 'resumo', nextSteps: ['a'], sentiment: 'positivo' })) } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  const proc = new CallInsightProcessor(prisma, downloader, transcription, insight, realtime);
  return { prisma, downloader, transcription, insight, realtime, updates, proc };
}

function job(data: any, attemptsMade = 0, attempts = 6) {
  return { data, attemptsMade, opts: { attempts } } as any;
}

describe('CallInsightProcessor.process', () => {
  it('baixa, transcreve, resume e grava READY + emite realtime', async () => {
    const d = makeDeps();
    await d.proc.process(job({ callId: 'call1' }));
    expect(d.downloader.download).toHaveBeenCalledWith('https://rec/x');
    expect(d.transcription.transcribeBuffer).toHaveBeenCalled();
    expect(d.insight.summarize).toHaveBeenCalled();
    const last = d.updates[d.updates.length - 1];
    expect(last.insightState).toBe('READY');
    expect(last.transcript).toBe('olá tudo bem');
    expect(d.realtime.emitToConversation).toHaveBeenCalledWith('conv1', 'call:insight', expect.any(Object));
  });

  it('SKIPPED quando não-atendida / sem gravação (não baixa)', async () => {
    const d = makeDeps({ call: { id: 'call1', organizationId: 'org1', conversationId: 'c', answered: false, recordingUrl: null, insightState: 'PENDING' } });
    await d.proc.process(job({ callId: 'call1' }));
    expect(d.downloader.download).not.toHaveBeenCalled();
    expect(d.updates[0].insightState).toBe('SKIPPED');
  });

  it('idempotente: já READY não reprocessa', async () => {
    const d = makeDeps({ call: { id: 'call1', organizationId: 'org1', conversationId: 'c', answered: true, recordingUrl: 'https://x', insightState: 'READY' } });
    await d.proc.process(job({ callId: 'call1' }));
    expect(d.downloader.download).not.toHaveBeenCalled();
  });

  it('download falha e NÃO é a última tentativa → re-lança (BullMQ re-tenta)', async () => {
    const d = makeDeps({ download: jest.fn(async () => { throw new Error('não pronta'); }) });
    await expect(d.proc.process(job({ callId: 'call1' }, 0, 6))).rejects.toThrow();
    expect(d.updates.find((u) => u.insightState === 'FAILED')).toBeUndefined();
  });

  it('download falha na ÚLTIMA tentativa → marca FAILED sem re-lançar', async () => {
    const d = makeDeps({ download: jest.fn(async () => { throw new Error('nunca ficou pronta'); }) });
    await expect(d.proc.process(job({ callId: 'call1' }, 5, 6))).resolves.toBeUndefined();
    expect(d.updates[d.updates.length - 1].insightState).toBe('FAILED');
  });

  it('resumo falha mas transcrição salva → READY com insight null', async () => {
    const d = makeDeps({ summarize: jest.fn(async () => { throw new Error('LLM off'); }) });
    await d.proc.process(job({ callId: 'call1' }));
    const last = d.updates[d.updates.length - 1];
    expect(last.insightState).toBe('READY');
    expect(last.transcript).toBe('olá tudo bem');
    expect(last.insight).toBeNull();
  });
});
