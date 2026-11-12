import { Injectable } from '@nestjs/common';
import type { LlmToolDefinition } from '../../ai-agents/llm/llm.types';
import { DailyScoreboardService } from '../../dashboard/daily-scoreboard/daily-scoreboard.service';
import { ManagerAlertsRepository, type AlertOrg } from '../../response-sla/manager-alerts/manager-alerts.repository';
import { selectOverdueWaits, summarizeScoreboard } from '../../response-sla/manager-alerts/manager-alerts.selection';
import { ManagerBotReportsService } from '../manager-bot.reports.service';
import { ManagerBotRepository } from '../manager-bot.repository';
import { matchesAgent, parseOptionalDate, parsePeriod, ToolInputError } from './assistant.period';

/** Itens por lista devolvidos ao modelo (o total vai junto). */
export const MAX_TOOL_ITEMS = 20;

const PERIOD = {
  inicio: { type: 'string', description: 'Primeiro dia, YYYY-MM-DD (fuso de São Paulo)' },
  fim: { type: 'string', description: 'Último dia (inclusive), YYYY-MM-DD' },
};
const AGENT = { type: 'string', description: 'Nome (ou parte) do vendedor; omita para todos' };

export const ASSISTANT_TOOLS: LlmToolDefinition[] = [
  {
    name: 'placar_do_dia',
    description:
      'Placar de um dia por vendedor: recebidos (novos e retorno), finalizadas, não começou, esperando resposta, abertas, tempo médio para puxar; e a fila sem dono. Use para perguntas sobre hoje ou um dia específico.',
    parameters: {
      type: 'object',
      properties: { data: { type: 'string', description: 'YYYY-MM-DD; omita para hoje' }, vendedor: AGENT },
    },
  },
  {
    name: 'sla_periodo',
    description:
      'SLA de resposta (meta em minutos úteis) no período: % no prazo geral e por vendedor, com quantas esperas contaram.',
    parameters: { type: 'object', properties: { ...PERIOD, vendedor: AGENT }, required: ['inicio', 'fim'] },
  },
  {
    name: 'esperando_agora',
    description: 'Clientes esperando resposta humana agora, com o vendedor dono e há quantos minutos úteis.',
    parameters: { type: 'object', properties: { vendedor: AGENT } },
  },
  {
    name: 'fila_agora',
    description: 'Fila sem dono agora: quantas conversas e há quanto tempo está a mais antiga.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'vendas_perdidas',
    description: 'Vendas perdidas no período: total, por motivo e por vendedor.',
    parameters: { type: 'object', properties: PERIOD, required: ['inicio', 'fim'] },
  },
  {
    name: 'volume_periodo',
    description: 'Conversas novas e finalizadas no período. Para comparar períodos, chame uma vez para cada.',
    parameters: { type: 'object', properties: PERIOD, required: ['inicio', 'fim'] },
  },
  {
    name: 'equipe_agora',
    description:
      'Equipe agora: quem está online/ausente/offline, se está dentro do expediente, quantos clientes esperam por ele e minutos online hoje.',
    parameters: { type: 'object', properties: {} },
  },
];

type Args = Record<string, unknown>;
type Handler = (org: AlertOrg, args: Args, now: Date) => Promise<unknown>;

function limited<T>(items: T[]) {
  return { total: items.length, itens: items.slice(0, MAX_TOOL_ITEMS) };
}

/** Executa as ferramentas do assistente. Todas só leitura, presas à org. */
@Injectable()
export class AssistantTools {
  private readonly handlers: Record<string, Handler> = {
    placar_do_dia: (org, args) => this.dayScore(org, args),
    sla_periodo: (org, args) => this.sla(org, args),
    esperando_agora: (org, args, now) => this.waiting(org, args, now),
    fila_agora: (org) => this.reports.queue(org),
    vendas_perdidas: (org, args) => this.lost(org, args),
    volume_periodo: (org, args) => this.volume(org, args),
    equipe_agora: (org, _args, now) => this.team(org, now),
  };

  constructor(
    private readonly scoreboard: DailyScoreboardService,
    private readonly waits: ManagerAlertsRepository,
    private readonly reports: ManagerBotReportsService,
    private readonly repository: ManagerBotRepository,
  ) {}

  /** Resultado em JSON para o modelo. Erro vira `{erro}`, nunca exceção. */
  async run(org: AlertOrg, name: string, args: Args, now: Date): Promise<string> {
    const handler = this.handlers[name];
    if (!handler) return JSON.stringify({ erro: `ferramenta desconhecida: ${name}` });
    try {
      return JSON.stringify(await handler(org, args ?? {}, now));
    } catch (err) {
      const detail = err instanceof ToolInputError ? err.message : 'falha ao consultar o banco';
      return JSON.stringify({ erro: detail });
    }
  }

  private async dayScore(org: AlertOrg, args: Args) {
    const board = await this.scoreboard.getDailyScoreboard(org.id, parseOptionalDate(args.data));
    const agents = board.agents
      .filter((a) => matchesAgent(a.agent.name, args.vendedor))
      .map((a) => ({
        vendedor: a.agent.name,
        recebidos: a.assignedToday,
        novos: a.assignedNewToday,
        retorno: a.returnedToday,
        finalizadas: a.closedToday,
        naoComecou: a.notStarted,
        esperando: a.awaitingReply,
        abertas: a.openTotal,
        minutosMediosParaPuxar: a.avgPickupMinutes,
      }));
    return { data: board.date, fila: board.queue, vendedores: agents };
  }

  private async sla(org: AlertOrg, args: Args) {
    const range = parsePeriod(args.inicio, args.fim, org.tz);
    const rows = await this.waits.listCountedWaits(org.id, range.from, range.to);
    const filtered = rows.filter((r) => matchesAgent(r.agentName, args.vendedor));
    const summary = summarizeScoreboard(filtered);
    if (!summary) return { esperasContadas: 0 };
    return {
      noPrazo: summary.overall.within,
      esperasContadas: summary.overall.total,
      percentual: Math.round((summary.overall.within / summary.overall.total) * 100),
      porVendedor: summary.agents,
    };
  }

  private async waiting(org: AlertOrg, args: Args, now: Date) {
    const all = selectOverdueWaits(await this.waits.listOpenWaits(org), org.tz, now, 0);
    const mine = all.filter((w) => matchesAgent(w.agentName ?? 'sem dono', args.vendedor));
    return limited(
      mine.map((w) => ({ cliente: w.contactName, vendedor: w.agentName ?? 'sem dono', minutosUteis: w.businessMinutes })),
    );
  }

  private async lost(org: AlertOrg, args: Args) {
    const range = parsePeriod(args.inicio, args.fim, org.tz);
    const [byReason, byAgent] = await Promise.all([
      this.repository.lostByReason(org.id, range),
      this.repository.lostByAgent(org.id, range),
    ]);
    return { total: byReason.reduce((s, r) => s + r.count, 0), porMotivo: byReason, porVendedor: byAgent };
  }

  private async volume(org: AlertOrg, args: Args) {
    const range = parsePeriod(args.inicio, args.fim, org.tz);
    const [novas, finalizadas] = await Promise.all([
      this.repository.countEntered(org.id, range),
      this.repository.countClosed(org.id, range),
    ]);
    return { novas, finalizadas };
  }

  private async team(org: AlertOrg, now: Date) {
    const rows = await this.reports.teamDetail(org, now);
    return rows.map((r) => ({
      nome: r.name,
      status: r.status,
      noExpediente: r.schedule.withinHours,
      voltaEm: r.schedule.returnsAt,
      clientesEsperando: r.waitingCount,
      minutosOnlineHoje: r.today.onlineMinutes,
    }));
  }
}
