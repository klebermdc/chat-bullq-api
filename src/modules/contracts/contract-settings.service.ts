import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { BlockedDateDto, UpdateContractSettingsDto } from './dto/settings.dto';

const DEFAULTS = {
  terms: '',
  pixKeys: [],
  defaultPixKey: null,
  receiptNotifyEmail: null,
  usdPaymentInstructions: null,
  guides: [],
  sellers: [],
  companyName: null,
  companyDocument: null,
  companyAddress: null,
};

const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Converte o DTO em campos graváveis; pixKeys vira JSON puro (sem instâncias de classe). */
function toSettingsFields(dto: UpdateContractSettingsDto): Prisma.ContractSettingsUncheckedUpdateInput {
  const { pixKeys, ...rest } = dto;
  return {
    ...rest,
    ...(pixKeys ? { pixKeys: pixKeys.map(({ value, label }) => ({ value, label })) } : {}),
  };
}

@Injectable()
export class ContractSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string) {
    const row = await this.prisma.contractSettings.findUnique({ where: { organizationId } });
    return { ...DEFAULTS, ...(row ?? {}), organizationId };
  }

  update(organizationId: string, dto: UpdateContractSettingsDto) {
    const fields = toSettingsFields(dto);
    const create: Prisma.ContractSettingsUncheckedCreateInput = {
      ...DEFAULTS,
      ...(fields as Prisma.ContractSettingsUncheckedCreateInput),
      organizationId,
    };
    return this.prisma.contractSettings.upsert({
      where: { organizationId },
      create,
      update: fields,
    });
  }

  listBlockedDates(organizationId: string, guideName?: string) {
    return this.prisma.contractBlockedDate.findMany({
      where: { organizationId, ...(guideName ? { guideName: { equals: guideName, mode: 'insensitive' } } : {}) },
      orderBy: { date: 'asc' },
    });
  }

  blockDate(organizationId: string, dto: BlockedDateDto) {
    const date = utcDate(dto.date);
    const reason = dto.reason ?? 'lotado';
    const guideName = dto.guideName.trim();
    return this.prisma.contractBlockedDate.upsert({
      where: { organizationId_guideName_date: { organizationId, guideName, date } },
      create: { organizationId, guideName, date, reason },
      update: { reason },
    });
  }

  async unblockDate(organizationId: string, guideName: string, date: string) {
    const { count } = await this.prisma.contractBlockedDate.deleteMany({
      where: {
        organizationId,
        guideName: { equals: guideName.trim(), mode: 'insensitive' },
        date: utcDate(date),
      },
    });
    return { deleted: count };
  }
}
