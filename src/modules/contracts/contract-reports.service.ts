import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractsRepository } from './contracts.repository';
import { monthRange } from './contracts.service';
import { parseAmount } from './domain/amount';
import { deriveStatus } from './domain/contract-status';
import { multipassReminders } from './domain/multipass';
import { readContractDates } from './domain/park-dates';

const guideFilter = (guide?: string): Prisma.ContractWhereInput =>
  guide ? { guideName: { equals: guide, mode: 'insensitive' } } : {};

@Injectable()
export class ContractReportsService {
  constructor(private readonly repo: ContractsRepository) {}

  async billing(organizationId: string, f: { year: number; month?: number; guide?: string; q?: string }) {
    const rows = await this.repo.findAll({
      organizationId,
      createdAt: monthRange(f.year, f.month),
      ...guideFilter(f.guide),
      ...(f.q
        ? { OR: [{ fullName: { contains: f.q, mode: 'insensitive' } }, { cpf: { contains: f.q } }, { amount: { contains: f.q } }] }
        : {}),
    });
    const totals = { BRL: 0, USD: 0, unparsed: 0 };
    const items = rows.map((c) => {
      const parsed = parseAmount(c.amount);
      if (parsed) totals[parsed.currency] = Math.round((totals[parsed.currency] + parsed.value) * 100) / 100;
      else totals.unparsed += 1;
      return {
        id: c.id, fullName: c.fullName, cpf: c.cpf, amount: c.amount, currency: parsed?.currency ?? null,
        guideName: c.guideName, createdAt: c.createdAt, invoiceIssued: c.invoiceIssued, status: deriveStatus(c),
      };
    });
    return { items, totals };
  }

  async multipassReminders(organizationId: string, guide: string | undefined, today: string) {
    const rows = await this.repo.findAll({ organizationId, purchased: false, ...guideFilter(guide) });
    return multipassReminders(
      rows.map((c) => ({
        id: c.id, fullName: c.fullName, phone: c.phone, guideName: c.guideName,
        disneyGuest: c.disneyGuest, purchased: c.purchased,
        dates: readContractDates(c).map((d) => d.date),
      })),
      today,
    );
  }

  /** Eventos do calendário do guia: uma linha por data de parque. */
  async calendar(organizationId: string, guide?: string) {
    const rows = await this.repo.findAll({ organizationId, ...guideFilter(guide) });
    return rows.flatMap((c) =>
      readContractDates(c).map((d) => ({
        contractId: c.id, fullName: c.fullName, phone: c.phone, guideName: c.guideName,
        disneyGuest: c.disneyGuest, purchased: c.purchased, parkId: d.parkId, parkLabel: d.label, date: d.date,
      })),
    );
  }
}
