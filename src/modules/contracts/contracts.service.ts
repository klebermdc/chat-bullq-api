import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ContractsRepository } from './contracts.repository';
import { formatParkDates, readContractDates, type ParkDate } from './domain/park-dates';
import { statusWhere } from './domain/contract-status';
import type { CreateContractDto, MoveDateDto, UpdateContractDto, UpdateFlagsDto } from './dto/contract.dto';
import type { ListContractsDto } from './dto/list-contracts.dto';

export function generateContractToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Instâncias de ParkDateDto viram objetos puros antes de ir para o Json do Prisma. */
function toPlainParkDates(parkDates: ReadonlyArray<ParkDate>): ParkDate[] {
  return parkDates.map(({ parkId, date }) => ({ parkId, date }));
}

function datesFields(parkDates: ParkDate[], toBeDefined: boolean) {
  if (!toBeDefined && parkDates.length === 0) {
    throw new BadRequestException('Informe ao menos uma data de parque ou marque "datas a definir".');
  }
  const kept = toBeDefined ? [] : toPlainParkDates(parkDates);
  return {
    parkDates: kept as unknown as Prisma.InputJsonValue,
    datesToBeDefined: toBeDefined,
    requestedDates: formatParkDates(kept),
    days: kept.length,
  };
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly repo: ContractsRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  private changed(organizationId: string, id: string) {
    this.realtime.emitToOrg(organizationId, 'contract:changed', { id });
  }

  async list(organizationId: string, f: ListContractsDto) {
    const page = f.page ?? 1;
    const perPage = f.perPage ?? 50;
    const and: Prisma.ContractWhereInput[] = [];
    if (f.status) and.push(statusWhere(f.status));
    if (f.q) {
      const q = f.q.trim();
      and.push({
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { cpf: { contains: q } },
        ],
      });
    }
    const where: Prisma.ContractWhereInput = {
      organizationId,
      ...(f.guide ? { guideName: { equals: f.guide, mode: 'insensitive' } } : {}),
      ...(f.year ? { createdAt: monthRange(f.year, f.month) } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const [items, total] = await this.repo.findPage(where, (page - 1) * perPage, perPage);
    return { items, total, page, perPage };
  }

  async get(organizationId: string, id: string) {
    const c = await this.repo.findInOrg(organizationId, id);
    if (!c) throw new NotFoundException('Contrato não encontrado');
    return c;
  }

  async create(organizationId: string, userId: string, dto: CreateContractDto) {
    const { createPlanejadorAccess: _ignored, parkDates, datesToBeDefined, ...rest } = dto;
    const created = await this.repo.create({
      ...rest,
      ...datesFields(parkDates, datesToBeDefined),
      organizationId,
      createdById: userId,
      acceptanceToken: generateContractToken(),
    });
    this.changed(organizationId, created.id);
    return created;
  }

  async update(organizationId: string, id: string, dto: UpdateContractDto) {
    const current = await this.get(organizationId, id);
    if (current.acceptedAt) {
      throw new ConflictException('Contrato já aceito pelo cliente: os dados não podem mais ser alterados.');
    }
    const { parkDates, datesToBeDefined, ...rest } = dto;
    const data: Prisma.ContractUncheckedUpdateInput = { ...rest };
    if (parkDates !== undefined || datesToBeDefined !== undefined) {
      Object.assign(
        data,
        datesFields(parkDates ?? (current.parkDates as unknown as ParkDate[]), datesToBeDefined ?? current.datesToBeDefined),
      );
    }
    const updated = await this.repo.updateInOrg(organizationId, id, data);
    this.changed(organizationId, id);
    return updated;
  }

  async updateFlags(organizationId: string, id: string, dto: UpdateFlagsDto) {
    await this.get(organizationId, id);
    const updated = await this.repo.updateInOrg(organizationId, id, { ...dto });
    this.changed(organizationId, id);
    return updated;
  }

  async regenerateToken(organizationId: string, id: string) {
    const current = await this.get(organizationId, id);
    if (current.acceptedAt) throw new ConflictException('Contrato já aceito: o link não pode ser trocado.');
    const updated = await this.repo.updateInOrg(organizationId, id, { acceptanceToken: generateContractToken() });
    this.changed(organizationId, id);
    return updated!;
  }

  async moveDate(organizationId: string, id: string, dto: MoveDateDto) {
    const current = await this.get(organizationId, id);
    const dates = readContractDates(current);
    const idx = dates.findIndex((d) => d.date === dto.from);
    if (idx < 0) throw new BadRequestException('Data de origem não está no contrato');
    if (dates.some((d) => !d.parkId)) {
      throw new BadRequestException('Contrato tem parque fora da lista; edite as datas pelo formulário.');
    }
    const next = dates.map((d, i) => ({ parkId: d.parkId as string, date: i === idx ? dto.to : d.date }));
    const updated = await this.repo.updateInOrg(organizationId, id, datesFields(next, false));
    this.changed(organizationId, id);
    return updated;
  }

  async remove(organizationId: string, id: string) {
    if (!(await this.repo.deleteInOrg(organizationId, id))) throw new NotFoundException('Contrato não encontrado');
    this.changed(organizationId, id);
    return { deleted: true };
  }
}

export function monthRange(year: number, month?: number) {
  if (!month) return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
}
