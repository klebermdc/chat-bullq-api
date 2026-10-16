import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Contract } from '@prisma/client';
import { randomBytes } from 'crypto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { actorScope, isStaff, type ContractActor } from './contract-actor';
import { ContractSettingsService } from './contract-settings.service';
import { toListItem } from './contract-view';
import { DATES_TO_BE_DEFINED_TEXT } from './contracts.constants';
import { ContractsRepository } from './contracts.repository';
import { formatParkDates, readContractDates, type ParkDate } from './domain/park-dates';
import { statusWhere } from './domain/contract-status';
import type { CreateContractDto, MoveDateDto, UpdateContractDto, UpdateFlagsDto } from './dto/contract.dto';
import type { ListContractsDto } from './dto/list-contracts.dto';
import { ContractPdfService, type ContractPdfInput } from './pdf/contract-pdf.service';

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

/** Datas de parque preenchidas implicam "a definir" = false; pedir os dois é contraditório. */
function resolveToBeDefined(parkDates: ReadonlyArray<ParkDate>, flag: boolean | undefined): boolean {
  if (flag && parkDates.length) {
    throw new BadRequestException('Escolha datas de parque ou "datas a definir", não os dois.');
  }
  return flag ?? false;
}

/**
 * Contrato legado (sem parkDates) com linhas de texto que não viram data:
 * regravar a partir das datas lidas apagaria essas linhas.
 */
function hasUnreadableLegacyLines(c: Pick<Contract, 'parkDates' | 'requestedDates' | 'createdAt'>): boolean {
  if (Array.isArray(c.parkDates) && c.parkDates.length) return false;
  const lines = (c.requestedDates ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== DATES_TO_BE_DEFINED_TEXT);
  return lines.length !== readContractDates(c).length;
}

const ACCEPTED_MESSAGE = 'Contrato já aceito pelo cliente: os dados não podem mais ser alterados.';
const NOT_FOUND_MESSAGE = 'Contrato não encontrado';

@Injectable()
export class ContractsService {
  constructor(
    private readonly repo: ContractsRepository,
    private readonly realtime: RealtimeGateway,
    private readonly settings: ContractSettingsService,
    private readonly pdf: ContractPdfService,
  ) {}

  private changed(organizationId: string, id: string) {
    this.realtime.emitToOrg(organizationId, 'contract:changed', { id });
  }

  async list(organizationId: string, actor: ContractActor, f: ListContractsDto) {
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
      ...actorScope(actor),
      organizationId,
      ...(f.guide ? { guideName: { equals: f.guide, mode: 'insensitive' } } : {}),
      ...(f.year ? { createdAt: monthRange(f.year, f.month) } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const [rows, total] = await this.repo.findPage(where, (page - 1) * perPage, perPage);
    return { items: rows.map(toListItem), total, page, perPage };
  }

  /** Contrato fora do escopo do ator dá 404, como se não existisse. */
  async get(organizationId: string, actor: ContractActor, id: string) {
    const c = await this.repo.findInOrg(organizationId, id, actorScope(actor));
    if (!c) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return c;
  }

  async create(organizationId: string, userId: string, dto: CreateContractDto) {
    const { createPlanejadorAccess: _ignored, parkDates, datesToBeDefined, ...rest } = dto;
    const created = await this.repo.create({
      ...rest,
      ...datesFields(parkDates, resolveToBeDefined(parkDates, datesToBeDefined)),
      organizationId,
      createdById: userId,
      acceptanceToken: generateContractToken(),
    });
    this.changed(organizationId, created.id);
    return created;
  }

  async update(organizationId: string, actor: ContractActor, id: string, dto: UpdateContractDto) {
    const current = await this.get(organizationId, actor, id);
    if (current.acceptedAt) throw new ConflictException(ACCEPTED_MESSAGE);
    const { parkDates, datesToBeDefined, ...rest } = dto;
    const data: Prisma.ContractUncheckedUpdateInput = { ...rest };
    if (parkDates?.length) {
      Object.assign(data, datesFields(parkDates, resolveToBeDefined(parkDates, datesToBeDefined)));
    } else if (parkDates !== undefined || datesToBeDefined !== undefined) {
      Object.assign(
        data,
        datesFields(parkDates ?? (current.parkDates as unknown as ParkDate[]), datesToBeDefined ?? current.datesToBeDefined),
      );
    }
    // acceptedAt: null no where fecha a corrida com o aceite público.
    const updated = await this.repo.updateInOrg(organizationId, id, data, { ...actorScope(actor), acceptedAt: null });
    if (!updated) throw new ConflictException(ACCEPTED_MESSAGE);
    this.changed(organizationId, id);
    return updated;
  }

  /** AGENT só pode mexer em "comprado"; pago e NF são do staff. */
  async updateFlags(organizationId: string, actor: ContractActor, id: string, dto: UpdateFlagsDto) {
    if (!isStaff(actor) && (dto.paid !== undefined || dto.invoiceIssued !== undefined)) {
      throw new ForbiddenException('Só administradores marcam pago ou nota fiscal.');
    }
    await this.get(organizationId, actor, id);
    const updated = await this.repo.updateInOrg(organizationId, id, { ...dto }, actorScope(actor));
    if (!updated) throw new NotFoundException(NOT_FOUND_MESSAGE);
    this.changed(organizationId, id);
    return updated;
  }

  async regenerateToken(organizationId: string, actor: ContractActor, id: string) {
    const current = await this.get(organizationId, actor, id);
    if (current.acceptedAt) throw new ConflictException('Contrato já aceito: o link não pode ser trocado.');
    const updated = await this.repo.updateInOrg(
      organizationId,
      id,
      { acceptanceToken: generateContractToken() },
      { ...actorScope(actor), acceptedAt: null },
    );
    if (!updated) throw new ConflictException('Contrato já aceito: o link não pode ser trocado.');
    this.changed(organizationId, id);
    return updated;
  }

  async moveDate(organizationId: string, actor: ContractActor, id: string, dto: MoveDateDto) {
    const current = await this.get(organizationId, actor, id);
    if (hasUnreadableLegacyLines(current)) {
      throw new BadRequestException('Contrato antigo com datas em formato livre; edite as datas pelo formulário');
    }
    const dates = readContractDates(current);
    const idx = dates.findIndex((d) => d.date === dto.from && (!dto.parkId || d.parkId === dto.parkId));
    if (idx < 0) throw new BadRequestException('Data de origem não está no contrato');
    if (dates.some((d) => !d.parkId)) {
      throw new BadRequestException('Contrato tem parque fora da lista; edite as datas pelo formulário.');
    }
    const next = dates.map((d, i) => ({ parkId: d.parkId as string, date: i === idx ? dto.to : d.date }));
    const updated = await this.repo.updateInOrg(organizationId, id, datesFields(next, false), actorScope(actor));
    if (!updated) throw new NotFoundException(NOT_FOUND_MESSAGE);
    this.changed(organizationId, id);
    return updated;
  }

  async stats(organizationId: string, actor: ContractActor, guide?: string) {
    const base: Prisma.ContractWhereInput = {
      ...actorScope(actor),
      organizationId,
      ...(guide ? { guideName: { equals: guide, mode: 'insensitive' } } : {}),
    };
    const [total, accepted, paid, purchased, pending] = await Promise.all([
      this.repo.count(base),
      this.repo.count({ ...base, ...statusWhere('accepted') }),
      this.repo.count({ ...base, ...statusWhere('paid') }),
      this.repo.count({ ...base, ...statusWhere('purchased') }),
      this.repo.count({ ...base, ...statusWhere('pending') }),
    ]);
    return { total, accepted, paid, purchased, pending };
  }

  /** Monta a entrada do PDF só com os campos que ele mostra (sem token, ids etc.). */
  async buildPdfInput(
    organizationId: string,
    contract: Contract,
    acceptance?: ContractPdfInput['acceptance'],
  ): Promise<ContractPdfInput> {
    const s = await this.settings.get(organizationId);
    return {
      company: { name: s.companyName ?? '', document: s.companyDocument ?? '', address: s.companyAddress ?? '' },
      contract: {
        fullName: contract.fullName,
        cpf: contract.cpf,
        address: contract.address,
        cep: contract.cep,
        email: contract.email,
        phone: contract.phone,
        guideName: contract.guideName,
        people: contract.people,
        days: contract.days,
        amount: contract.amount,
        paymentMethod: contract.paymentMethod,
        notes: contract.notes,
        dates: readContractDates(contract).map((d) => ({ label: d.label, date: d.date })),
      },
      // Contrato aceito mostra os termos exatamente como o cliente aceitou.
      terms: contract.acceptedTermsText ?? s.terms,
      acceptance,
    };
  }

  /** PDF guardado no aceite; senão um PDF gerado agora (sem evidência). */
  async pdfFor(organizationId: string, actor: ContractActor, id: string): Promise<{ key: string } | { buffer: Buffer }> {
    const c = await this.get(organizationId, actor, id);
    if (c.acceptancePdfKey?.startsWith(`contracts/${organizationId}/`)) return { key: c.acceptancePdfKey };
    return { buffer: await this.pdf.render(await this.buildPdfInput(organizationId, c)) };
  }

  /** Os arquivos do contrato ficam no MinIO de propósito (histórico e prova do aceite); não apagar. */
  async remove(organizationId: string, actor: ContractActor, id: string) {
    if (!(await this.repo.deleteInOrg(organizationId, id, actorScope(actor)))) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    this.changed(organizationId, id);
    return { deleted: true };
  }
}

/** Brasília é UTC-3 fixo (sem horário de verão desde 2019): meia-noite BRT = 03:00 UTC. */
const BRT_OFFSET_HOURS = 3;

/** Limites de um mês (ou do ano, sem mês) em horário de Brasília. Date.UTC normaliza mês 12 → janeiro seguinte. */
export function monthRange(year: number, month?: number) {
  if (!month) {
    return { gte: new Date(Date.UTC(year, 0, 1, BRT_OFFSET_HOURS)), lt: new Date(Date.UTC(year + 1, 0, 1, BRT_OFFSET_HOURS)) };
  }
  return {
    gte: new Date(Date.UTC(year, month - 1, 1, BRT_OFFSET_HOURS)),
    lt: new Date(Date.UTC(year, month, 1, BRT_OFFSET_HOURS)),
  };
}
