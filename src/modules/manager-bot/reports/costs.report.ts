import type { SenderRow, TemplateRow } from '../../whatsapp-costs/breakdown.aggregate';
import type { ChannelCosts, CostsReport } from '../../whatsapp-costs/whatsapp-costs.service';
import { escapeHtml } from '../manager-bot.format';

/** Textos de custo do WhatsApp para o Telegram (puros). */

export const TOP_SENDERS = 5;
export const TOP_TEMPLATES = 3;

const CATEGORY_LABEL: Record<string, string> = {
  SERVICE: 'Respostas (24h)',
  MARKETING: 'Templates de marketing',
  UTILITY: 'Templates de utilidade',
  AUTHENTICATION: 'Autenticação',
};

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const fmtInt = (n: number): string => new Intl.NumberFormat('pt-BR').format(n);
const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? c.toLowerCase();

function costByCurrency(report: CostsReport): string {
  const parts = report.totalsByCurrency.filter((t) => t.cost > 0).map((t) => formatMoney(t.cost, t.currency));
  return parts.length ? parts.join(' + ') : 'sem custo';
}

function billableCount(report: CostsReport): number {
  return report.channels.reduce((sum, ch) => sum + ch.totals.billable, 0);
}

function failedChannels(report: CostsReport): string[] {
  return report.channels.filter((c) => c.status === 'error').map((c) => escapeHtml(c.channelName));
}

/** Uma linha para a abertura: custo de ontem e acumulado do mês. */
export function buildCostOpeningLines(yesterday: CostsReport, month: CostsReport): string[] {
  const failed = failedChannels(month);
  return [
    `<b>WhatsApp ontem:</b> ${costByCurrency(yesterday)} (${fmtInt(billableCount(yesterday))} cobradas) · <b>no mês:</b> ${costByCurrency(month)}`,
    ...(failed.length ? [`⚠️ Sem custo da Meta para: ${failed.join(', ')}`] : []),
  ];
}

/**
 * Projeção do mês pelos dias já fechados (hoje fica de fora, está pela metade).
 * Null no dia 1º, quando ainda não há dia fechado.
 */
export function projectMonth(daily: ReadonlyArray<{ date: string; cost: number }>, today: string): number | null {
  const closed = daily.filter((d) => d.date < today);
  if (closed.length === 0) return null;
  const [y, m] = today.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = closed.reduce((sum, d) => sum + d.cost, 0);
  return Number(((total / closed.length) * daysInMonth).toFixed(2));
}

function categoryLines(channel: ChannelCosts): string[] {
  return channel.totals.byCategory
    .filter((r) => r.cost > 0)
    .map((r) => `• ${categoryLabel(r.category)}: ${formatMoney(r.cost, channel.currency)} (${fmtInt(r.volume)})`);
}

export function senderLines(senders: ReadonlyArray<SenderRow>, currency: string): string[] {
  return senders
    .slice(0, TOP_SENDERS)
    .map((s, i) => `${i + 1}. ${escapeHtml(s.name)} — ${formatMoney(s.cost, currency)} (${fmtInt(s.service + s.marketing + s.utility)} msgs)`);
}

export function templateLines(templates: ReadonlyArray<TemplateRow>, currency: string): string[] {
  return templates
    .slice(0, TOP_TEMPLATES)
    .map((t) => `• ${escapeHtml(t.name)}${t.category === 'MARKETING' ? ' (marketing)' : ''} — ${fmtInt(t.sent)} envios, ${formatMoney(t.cost, currency)}`);
}

export interface CostsCommandInput {
  todayLabel: string;
  today: string;
  todayReport: CostsReport;
  month: CostsReport;
  /** Canal de maior custo no mês, com quem gerou o custo. */
  top: { channel: ChannelCosts; senders: SenderRow[]; templates: TemplateRow[] } | null;
}

function channelBlock(channel: ChannelCosts, today: string): string[] {
  if (channel.status === 'error') return [`<b>${escapeHtml(channel.channelName)}</b>: sem dados da Meta (${escapeHtml(channel.error ?? 'erro')})`];
  const projection = projectMonth(channel.daily, today);
  return [
    `<b>${escapeHtml(channel.channelName)}</b>: ${formatMoney(channel.totals.cost, channel.currency)} no mês` +
      (projection !== null ? ` · projeção ${formatMoney(projection, channel.currency)}` : ''),
    ...categoryLines(channel),
  ];
}

/** Resposta do /custos. */
export function buildCostsCommand(input: CostsCommandInput): string {
  const { month, top, today } = input;
  const blocks = month.channels.flatMap((ch) => ['', ...channelBlock(ch, today)]);
  const topBlock = top
    ? [
        '',
        `<b>Quem gera o custo</b> (${escapeHtml(top.channel.channelName)}, estimado)`,
        ...senderLines(top.senders, top.channel.currency),
        ...(top.templates.length ? ['', '<b>Templates mais caros</b>', ...templateLines(top.templates, top.channel.currency)] : []),
      ]
    : [];
  return [
    `💸 <b>Custos do WhatsApp · ${escapeHtml(input.todayLabel)}</b>`,
    '',
    `<b>Hoje até agora:</b> ${costByCurrency(input.todayReport)}`,
    `<b>No mês:</b> ${costByCurrency(month)}`,
    ...blocks,
    ...topBlock,
  ].join('\n');
}

function delta(current: number, previous: number): string {
  if (previous <= 0) return '';
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return ' (= semana anterior)';
  return ` (${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs semana anterior)`;
}

/** Bloco do resumo de segunda. */
export function buildCostWeeklyLines(
  last: CostsReport,
  before: CostsReport,
  top: { channel: ChannelCosts; senders: SenderRow[]; templates: TemplateRow[] } | null,
): string[] {
  const lines = last.totalsByCurrency
    .filter((t) => t.cost > 0)
    .map((t) => {
      const prev = before.totalsByCurrency.find((b) => b.currency === t.currency)?.cost ?? 0;
      return `${formatMoney(t.cost, t.currency)}${delta(t.cost, prev)}`;
    });
  return [
    '',
    '<b>Custo do WhatsApp</b>',
    lines.length ? lines.join(' · ') : 'Sem custo na semana.',
    ...last.channels.filter((c) => c.totals.cost > 0).flatMap((c) => categoryLines(c)),
    ...(top ? ['', '<b>Quem mais gerou custo</b>', ...senderLines(top.senders, top.channel.currency)] : []),
    ...(top?.templates.length ? ['', '<b>Templates mais caros</b>', ...templateLines(top.templates, top.channel.currency)] : []),
  ];
}

/** Alerta de teto diário; null se ainda não passou. */
export function formatCostAlert(today: CostsReport, threshold: number): string | null {
  const over = today.totalsByCurrency.filter((t) => t.cost >= threshold);
  if (over.length === 0) return null;
  const value = over.map((t) => formatMoney(t.cost, t.currency)).join(' + ');
  return [
    `💸 <b>Custo do WhatsApp passou do teto hoje</b>`,
    `${value} até agora (teto ${formatMoney(threshold, over[0].currency)}).`,
    'Mande /custos para ver quem está gerando o custo.',
  ].join('\n');
}

export function topChannel(report: CostsReport): ChannelCosts | null {
  const ok = report.channels.filter((c) => c.status === 'ok' && c.totals.cost > 0);
  return ok.sort((a, b) => b.totals.cost - a.totals.cost)[0] ?? null;
}
