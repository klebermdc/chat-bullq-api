import { Injectable } from '@nestjs/common';
import { actorScope, type ContractActor } from '../contract-actor';
import { ContractsRepository } from '../contracts.repository';
import { buildCalendarEvents, CALENDAR_TIME_ZONE, type CalendarEvent } from './calendar-events';

export interface CalendarWindow {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD, em Orlando
}

export interface ContractCalendarResponse {
  timezone: typeof CALENDAR_TIME_ZONE;
  from: string;
  to: string;
  /** false quando o filtro de guia deixou a lista parcial: não dá para apagar eventos com base nela. */
  complete: boolean;
  count: number;
  events: CalendarEvent[];
}

/** Base do link "Contrato:" na descrição; vazio quando o env não está configurado. */
const panelBaseUrl = () => (process.env.APP_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');

/**
 * Eventos desejados no Google Agenda (a rotina do Claude sincroniza pelo MCP).
 * AGENT só recebe os contratos que criou (`actorScope`).
 */
@Injectable()
export class ContractCalendarService {
  constructor(private readonly repo: ContractsRepository) {}

  async events(
    organizationId: string,
    actor: ContractActor,
    window: CalendarWindow,
    guide?: string,
  ): Promise<ContractCalendarResponse> {
    const rows = await this.repo.findForCalendar(organizationId, actorScope(actor), window.from, guide);
    const events = buildCalendarEvents(rows, { ...window, panelBaseUrl: panelBaseUrl() });
    return {
      timezone: CALENDAR_TIME_ZONE,
      from: window.from,
      to: window.to,
      complete: !guide,
      count: events.length,
      events,
    };
  }
}
