import type { CostsReport } from '../../whatsapp-costs/whatsapp-costs.service';
import {
  buildCostOpeningLines,
  buildCostsCommand,
  buildCostWeeklyLines,
  formatCostAlert,
  formatMoney,
  projectMonth,
} from './costs.report';

const NBSP = / /g;
const plain = (s: string) => s.replace(NBSP, ' ');

function report(cost: number, billable = 100, over: Partial<CostsReport> = {}): CostsReport {
  return {
    from: '2026-11-01',
    to: '2026-11-13',
    tz: 'America/Sao_Paulo',
    totalsByCurrency: [{ currency: 'BRL', cost }],
    channels: [
      {
        channelId: 'novo',
        channelName: 'Orlando Fast Pass',
        currency: 'BRL',
        status: 'ok',
        error: null,
        totals: {
          cost,
          billable,
          free: 5,
          byCategory: [
            { category: 'SERVICE', type: 'REGULAR', volume: billable, cost },
            { category: 'SERVICE', type: 'FREE_ENTRY_POINT', volume: 5, cost: 0 },
          ],
        },
        daily: [
          { date: '2026-11-12', cost: 60, billable: 1, free: 0, byCategory: {} },
          { date: '2026-11-13', cost: 10, billable: 1, free: 0, byCategory: {} },
        ],
      },
    ],
    ...over,
  };
}

const TOP = {
  channel: report(410).channels[0],
  senders: [{ name: 'Aline', kind: 'ai' as const, service: 2258, marketing: 105, utility: 0, cost: 112.81, conversations: 435 }],
  templates: [{ name: 'atendimento', category: 'MARKETING', sent: 133, cost: 42.79 }],
};

describe('costs.report', () => {
  it('formata dinheiro em reais e dólares', () => {
    expect(plain(formatMoney(1234.5, 'BRL'))).toBe('R$ 1.234,50');
    expect(plain(formatMoney(2, 'USD'))).toBe('US$ 2,00');
  });

  it('abertura: ontem e mês numa linha; canal sem acesso não faz ruído', () => {
    const failed = report(410, 1, {
      channels: [...report(410).channels, { ...report(0).channels[0], channelName: 'Comercial', status: 'error', error: 'x' }],
    });
    const lines = buildCostOpeningLines(report(67.61, 1473), failed).map(plain);
    expect(lines[0]).toBe('<b>WhatsApp ontem:</b> R$ 67,61 (1.473 cobradas) · <b>no mês:</b> R$ 410,00');
    expect(lines).toHaveLength(1);
  });

  it('projeção usa só dias fechados', () => {
    expect(projectMonth([{ date: '2026-11-12', cost: 60 }, { date: '2026-11-13', cost: 10 }], '2026-11-13')).toBe(1800);
    expect(projectMonth([{ date: '2026-11-01', cost: 5 }], '2026-11-01')).toBeNull();
  });

  it('/custos mostra hoje, mês, projeção, categorias, quem gera e templates', () => {
    const text = plain(
      buildCostsCommand({ todayLabel: '13/11', today: '2026-11-13', todayReport: report(10), month: report(410), top: TOP }),
    );
    expect(text).toContain('Hoje até agora:</b> R$ 10,00');
    expect(text).toContain('projeção R$ 1.800,00');
    expect(text).toContain('Respostas (24h): R$ 410,00');
    expect(text).toContain('1. Aline — R$ 112,81 (2.363 msgs)');
    expect(text).toContain('atendimento (marketing) — 133 envios');
  });

  it('semanal compara com a semana anterior', () => {
    const lines = buildCostWeeklyLines(report(410), report(200), TOP).map(plain).join('\n');
    expect(lines).toContain('R$ 410,00 (▲ 105% vs semana anterior)');
    expect(lines).toContain('Quem mais gerou custo');
  });

  it('alerta só acima do teto', () => {
    expect(formatCostAlert(report(119), 120)).toBeNull();
    expect(plain(formatCostAlert(report(130), 120) ?? '')).toContain('R$ 130,00 até agora (teto R$ 120,00)');
  });
});
