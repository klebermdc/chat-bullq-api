import { buildContextLayer } from './context.layer';

const baseCtx = {
  contact: { name: 'Fulano' },
  channel: { kind: 'WHATSAPP', name: 'WhatsApp Vendas' },
  recentMessages: [],
};

describe('ContextLayer — formatTime (horário de atendimento)', () => {
  it('fora do horário: injeta horário, retorno e diretiva de avisar', () => {
    const layer = buildContextLayer({
      ...baseCtx,
      time: {
        nowIso: '2026-07-26T03:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        businessHours: false,
        hoursSummary: 'seg: 09h às 18h',
        nextOpenLabel: 'amanhã às 09h',
      },
    } as any);
    expect(layer.content).toContain('FORA do horário');
    expect(layer.content).toContain('seg: 09h às 18h');
    expect(layer.content).toContain('amanhã às 09h');
    expect(layer.content.toLowerCase()).toContain('avise');
  });

  it('dentro do horário: texto curto de horário comercial', () => {
    const layer = buildContextLayer({
      ...baseCtx,
      time: {
        nowIso: '2026-07-26T15:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        businessHours: true,
      },
    } as any);
    expect(layer.content).toContain('dentro do horário comercial');
  });
});
