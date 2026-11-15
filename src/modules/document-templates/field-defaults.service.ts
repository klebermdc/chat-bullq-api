import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { extractPlaceholders } from './placeholders.util';
import {
  MAX_DEFAULT_ENTRIES,
  mergeFieldDefaults,
  readFieldDefaults,
  suggestAgencyFields,
} from './field-defaults.util';

export interface FieldDefaultsView {
  values: Record<string, string>;
  /** Campos de agência dos modelos ativos da org, para a tela oferecer. */
  suggestedFields: string[];
}

const COMPANY_SELECT = { companyName: true, companyDocument: true, companyAddress: true, fieldDefaults: true } as const;

/** "Dados da agência" dos modelos de contrato (só OWNER/ADMIN, via controller). */
@Injectable()
export class FieldDefaultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Só os valores, para o autofill. */
  async values(organizationId: string): Promise<Record<string, string>> {
    const settings = await this.prisma.contractSettings.findUnique({
      where: { organizationId },
      select: { fieldDefaults: true },
    });
    return readFieldDefaults(settings?.fieldDefaults);
  }

  async get(organizationId: string): Promise<FieldDefaultsView> {
    const settings = await this.prisma.contractSettings.findUnique({
      where: { organizationId },
      select: COMPANY_SELECT,
    });
    return this.view(organizationId, settings);
  }

  /**
   * Junta ao que está gravado: valor substitui, vazio remove, ausente fica.
   * Sem `contract_settings` ainda, cria a linha (termo vazio).
   */
  async update(organizationId: string, incoming: Record<string, string>): Promise<FieldDefaultsView> {
    const current = await this.values(organizationId);
    const merged = mergeFieldDefaults(current, incoming);
    if (Object.keys(merged).length > MAX_DEFAULT_ENTRIES) {
      throw new BadRequestException(`No máximo ${MAX_DEFAULT_ENTRIES} dados da agência.`);
    }
    const saved = await this.prisma.contractSettings.upsert({
      where: { organizationId },
      create: { organizationId, terms: '', fieldDefaults: merged },
      update: { fieldDefaults: merged },
      select: COMPANY_SELECT,
    });
    return this.view(organizationId, saved);
  }

  private async view(
    organizationId: string,
    settings: {
      companyName: string | null;
      companyDocument: string | null;
      companyAddress: string | null;
      fieldDefaults: unknown;
    } | null,
  ): Promise<FieldDefaultsView> {
    const templates = await this.prisma.documentTemplate.findMany({
      where: { organizationId, isActive: true },
      select: { body: true },
    });
    const placeholders = templates.flatMap((t) => extractPlaceholders(t.body));
    return {
      values: readFieldDefaults(settings?.fieldDefaults),
      suggestedFields: suggestAgencyFields(placeholders, settings),
    };
  }
}
