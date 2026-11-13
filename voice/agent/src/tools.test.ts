import { describe, expect, test, vi } from 'vitest';
import { quoteFollowUpTools } from './tools.js';

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    freeSlots: vi.fn().mockResolvedValue({ vendedor: 'Renata', horarios: [{ inicio: '2026-11-16T18:00:00.000Z', falado: 'segunda-feira, 16/11 às 15:00' }] }),
    schedule: vi.fn().mockResolvedValue({ ok: true, compromissoId: 'ap1', falado: 'segunda-feira, 16/11 às 15:00', confirmacaoEnviada: true }),
    ...overrides,
  } as any;
}

const byName = (tools: any[], name: string) => tools.find((t) => t.name === name);

describe('ferramentas da Aline', () => {
  test('agendar usa sempre a conversa da missão', async () => {
    const client = fakeClient();
    const tools = quoteFollowUpTools(client, 'cvMissao123');
    const r = await byName(tools, 'agendar_retorno').execute({ inicio: '2026-11-16T18:00:00.000Z', observacao: 'datas' }, {} as any);
    expect(client.schedule).toHaveBeenCalledWith({ conversationId: 'cvMissao123', startsAt: '2026-11-16T18:00:00.000Z', notes: 'datas' });
    expect(r).toMatchObject({ ok: true });
  });

  test('falha de rede vira resposta falável, sem derrubar a ligação', async () => {
    const client = fakeClient({ freeSlots: vi.fn().mockRejectedValue(new Error('timeout')), schedule: vi.fn().mockRejectedValue(new Error('500')) });
    const tools = quoteFollowUpTools(client, 'cvMissao123');
    await expect(byName(tools, 'horarios_livres').execute({}, {} as any)).resolves.toHaveProperty('erro');
    await expect(byName(tools, 'agendar_retorno').execute({ inicio: 'x' }, {} as any)).resolves.toMatchObject({ ok: false, codigo: 'FALHA' });
  });
});
