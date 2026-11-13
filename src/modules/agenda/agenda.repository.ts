import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_TIMEZONE, resolveHours, toHoursConfig } from '../response-sla/response-sla.rules';
import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';
import type { TimeSlot } from './agenda.rules';

const LIST_INCLUDE = {
  owner: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true, phone: true } },
} as const;

@Injectable()
export class AgendaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isMember(organizationId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.userOrganization.findFirst({ where: { organizationId, userId }, select: { userId: true } });
    return !!m;
  }

  async contactInOrg(organizationId: string, contactId: string): Promise<boolean> {
    const c = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId, deletedAt: null }, select: { id: true } });
    return !!c;
  }

  /** Fuso e expediente do vendedor (senão o da empresa; nenhum = 24h). */
  async ownerSchedule(organizationId: string, userId: string): Promise<{ tz: string; hours: BusinessHoursConfig | null }> {
    const [org, membership] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId }, select: { aiTimezone: true, aiBusinessHours: true } }),
      this.prisma.userOrganization.findFirst({ where: { organizationId, userId }, select: { workingHours: true } }),
    ]);
    return {
      tz: org?.aiTimezone || DEFAULT_TIMEZONE,
      hours: resolveHours(toHoursConfig(membership?.workingHours ?? null), toHoursConfig(org?.aiBusinessHours ?? null)),
    };
  }

  /** Compromissos MARCADOS do vendedor que começam em [from, to). */
  async findBusy(organizationId: string, ownerUserId: string, from: Date, to: Date, excludeId?: string): Promise<TimeSlot[]> {
    return this.prisma.appointment.findMany({
      where: {
        organizationId,
        ownerUserId,
        status: 'MARCADO',
        startsAt: { gte: from, lt: to },
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { startsAt: true, durationMin: true },
    });
  }

  async list(organizationId: string, q: { ownerUserId?: string; from: Date; to: Date }) {
    return this.prisma.appointment.findMany({
      where: {
        organizationId,
        ...(q.ownerUserId && { ownerUserId: q.ownerUserId }),
        startsAt: { gte: q.from, lt: q.to },
      },
      include: LIST_INCLUDE,
      orderBy: { startsAt: 'asc' },
      take: 1000,
    });
  }

  async findById(organizationId: string, id: string) {
    return this.prisma.appointment.findFirst({ where: { id, organizationId } });
  }

  async create(data: Prisma.AppointmentUncheckedCreateInput) {
    return this.prisma.appointment.create({ data, include: LIST_INCLUDE });
  }

  async update(id: string, data: Prisma.AppointmentUncheckedUpdateInput) {
    return this.prisma.appointment.update({ where: { id }, data, include: LIST_INCLUDE });
  }
}
