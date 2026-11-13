import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { OrgRole, type AppointmentKind, type AppointmentSource, type AppointmentStatus } from '@prisma/client';

// Valores como texto (tipados pelo Prisma): o enum novo não precisa existir em runtime nos testes.
const MARCADO: AppointmentStatus = 'MARCADO';
const MANUAL: AppointmentSource = 'MANUAL';
const RETORNO_LIGACAO: AppointmentKind = 'RETORNO_LIGACAO';
import { AgendaRepository } from './agenda.repository';
import { checkNewAppointment, DEFAULT_HORIZON_DAYS, freeSlots, type AppointmentRefusal } from './agenda.rules';

export interface AgendaViewer {
  userId: string;
  role: OrgRole | undefined;
}

export interface ListQuery {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD (inclusive)
  ownerUserId?: string;
}

export interface CreateInput {
  contactId: string;
  startsAt: string; // ISO com fuso
  ownerUserId?: string;
  conversationId?: string;
  cardId?: string;
  durationMin?: number;
  kind?: AppointmentKind;
  notes?: string;
  callId?: string;
}

/** Token opcional do relógio (testes); sem ele, usa a hora atual. */
export const AGENDA_CLOCK = 'AGENDA_CLOCK';

export const DEFAULT_DURATION_MIN = 15;
const MAX_LIST_DAYS = 62;
const DAY_MS = 86_400_000;
/** A Aline/tela só oferecem horários com pelo menos 1h de antecedência. */
export const DEFAULT_LEAD_MIN = 60;

const REFUSAL_MESSAGE: Record<AppointmentRefusal, string> = {
  PASSADO: 'Esse horário já passou.',
  FORA_DO_EXPEDIENTE: 'Fora do horário de atendimento do vendedor.',
  CONFLITO: 'O vendedor já tem compromisso nesse horário.',
};


function isManager(viewer: AgendaViewer): boolean {
  return viewer.role === OrgRole.OWNER || viewer.role === OrgRole.ADMIN;
}

function parseInstant(value: string, field: string): Date {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new BadRequestException(`${field} inválido`);
  return date;
}

function parseDay(value: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new BadRequestException(`${field} deve ser AAAA-MM-DD`);
  return parseInstant(`${value}T00:00:00-03:00`, field);
}

@Injectable()
export class AgendaService {
  private readonly clock: () => Date;

  constructor(
    private readonly repo: AgendaRepository,
    @Optional() @Inject(AGENDA_CLOCK) clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  async list(orgId: string, viewer: AgendaViewer, query: ListQuery) {
    const from = parseDay(query.from, 'from');
    const to = new Date(parseDay(query.to, 'to').getTime() + DAY_MS);
    const days = (to.getTime() - from.getTime()) / DAY_MS;
    if (days <= 0 || days > MAX_LIST_DAYS) {
      throw new BadRequestException(`Período deve ter de 1 a ${MAX_LIST_DAYS} dias`);
    }
    const ownerUserId = isManager(viewer) ? query.ownerUserId : viewer.userId;
    return this.repo.list(orgId, { ownerUserId, from, to });
  }

  async create(orgId: string, viewer: AgendaViewer, input: CreateInput, source: AppointmentSource = MANUAL) {
    const ownerUserId = isManager(viewer) ? input.ownerUserId ?? viewer.userId : viewer.userId;
    if (ownerUserId !== viewer.userId && !(await this.repo.isMember(orgId, ownerUserId))) {
      throw new ForbiddenException('Vendedor não pertence à empresa');
    }
    if (!(await this.repo.contactInOrg(orgId, input.contactId))) {
      throw new NotFoundException('Contato não encontrado');
    }
    const startsAt = parseInstant(input.startsAt, 'startsAt');
    const durationMin = input.durationMin ?? DEFAULT_DURATION_MIN;
    await this.assertBookable(orgId, ownerUserId, startsAt, durationMin);
    return this.repo.create({
      organizationId: orgId,
      ownerUserId,
      contactId: input.contactId,
      conversationId: input.conversationId ?? null,
      cardId: input.cardId ?? null,
      startsAt,
      durationMin,
      kind: input.kind ?? RETORNO_LIGACAO,
      status: MARCADO,
      source,
      notes: input.notes ?? null,
      callId: input.callId ?? null,
      createdByUserId: viewer.userId,
    });
  }

  async reschedule(orgId: string, viewer: AgendaViewer, id: string, input: { startsAt: string; durationMin?: number }) {
    const current = await this.findOwned(orgId, viewer, id);
    if (current.status !== MARCADO) {
      throw new BadRequestException('Só dá para remarcar compromisso marcado');
    }
    const startsAt = parseInstant(input.startsAt, 'startsAt');
    const durationMin = input.durationMin ?? current.durationMin;
    await this.assertBookable(orgId, current.ownerUserId, startsAt, durationMin, id);
    return this.repo.update(id, { startsAt, durationMin });
  }

  async setStatus(orgId: string, viewer: AgendaViewer, id: string, status: AppointmentStatus) {
    await this.findOwned(orgId, viewer, id);
    return this.repo.update(id, { status });
  }

  /** Horários livres do vendedor (tela "marcar retorno" e ferramenta da Aline). */
  async freeSlots(orgId: string, ownerUserId: string, opts: { count?: number; durationMin?: number } = {}) {
    const now = this.clock();
    const { tz, hours } = await this.repo.ownerSchedule(orgId, ownerUserId);
    const busy = await this.repo.findBusy(
      orgId,
      ownerUserId,
      now,
      new Date(now.getTime() + (DEFAULT_HORIZON_DAYS + 1) * DAY_MS),
    );
    return freeSlots({
      hours,
      tz,
      now,
      busy,
      durationMin: opts.durationMin ?? DEFAULT_DURATION_MIN,
      count: opts.count ?? 4,
      minLeadMin: DEFAULT_LEAD_MIN,
    });
  }

  private async findOwned(orgId: string, viewer: AgendaViewer, id: string) {
    const item = await this.repo.findById(orgId, id);
    // 404 também para compromisso de outro vendedor: não confirma que existe.
    if (!item || (!isManager(viewer) && item.ownerUserId !== viewer.userId)) {
      throw new NotFoundException('Compromisso não encontrado');
    }
    return item;
  }

  private async assertBookable(orgId: string, ownerUserId: string, startsAt: Date, durationMin: number, ignoreId?: string) {
    const { tz, hours } = await this.repo.ownerSchedule(orgId, ownerUserId);
    const busy = await this.repo.findBusy(
      orgId,
      ownerUserId,
      new Date(startsAt.getTime() - DAY_MS),
      new Date(startsAt.getTime() + DAY_MS),
      ...(ignoreId ? [ignoreId] : []),
    );
    const refusal = checkNewAppointment({ hours, tz, now: this.clock(), busy, startsAt, durationMin });
    if (refusal) throw new BadRequestException({ code: refusal, message: REFUSAL_MESSAGE[refusal] });
  }
}

