import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { mapLegacyBlockedDate, mapLegacyContract, storageKeyFor } from './legacy-contract.mapper';
import type { LegacyBlockedDateRow, LegacyContractRow } from './legacy.types';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
};

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Importa o histórico do app de contratos do Lovable. Tudo é upsert pela
 * origem (`legacyId`, (guia, data), organização), então rodar de novo na
 * virada só atualiza o que mudou e nunca duplica.
 */
@Injectable()
export class ContractsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async importContracts(organizationId: string, rows: LegacyContractRow[]) {
    let mapped: ReturnType<typeof mapLegacyContract>[];
    try {
      mapped = rows.map((r) => mapLegacyContract(organizationId, r));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    await this.prisma.$transaction(
      mapped.map((data) => {
        const { organizationId: _org, legacyId, ...update } = data;
        return this.prisma.contract.upsert({
          where: { organizationId_legacyId: { organizationId, legacyId: legacyId as string } },
          create: data,
          update,
        });
      }),
    );
    return { imported: mapped.length };
  }

  async importBlockedDates(organizationId: string, rows: LegacyBlockedDateRow[]) {
    let mapped: ReturnType<typeof mapLegacyBlockedDate>[];
    try {
      mapped = rows.map((r) => mapLegacyBlockedDate(organizationId, r));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    await this.prisma.$transaction(
      mapped.map((data) =>
        this.prisma.contractBlockedDate.upsert({
          where: {
            organizationId_guideName_date: {
              organizationId,
              guideName: data.guideName,
              date: data.date,
            },
          },
          create: data,
          update: { reason: data.reason },
        }),
      ),
    );
    return { imported: mapped.length };
  }

  async importSettings(organizationId: string, terms: string) {
    if (!terms?.trim()) throw new BadRequestException('Termos vazios');
    await this.prisma.contractSettings.upsert({
      where: { organizationId },
      create: { organizationId, terms },
      update: { terms },
    });
    return { imported: 1 };
  }

  async importFile(organizationId: string, legacyPath: string, buffer: Buffer) {
    let key: string;
    try {
      key = storageKeyFor(organizationId, legacyPath);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const existing = await this.storage.stat(key);
    if (existing && existing.size === buffer.byteLength) {
      return { key, status: 'exists' as const };
    }
    await this.storage.put(key, buffer, contentTypeFor(legacyPath));
    return { key, status: 'stored' as const };
  }

  async status(organizationId: string) {
    const [contracts, blockedDates, settings, withFiles] = await Promise.all([
      this.prisma.contract.count({ where: { organizationId } }),
      this.prisma.contractBlockedDate.count({ where: { organizationId } }),
      this.prisma.contractSettings.count({ where: { organizationId } }),
      this.prisma.contract.count({
        where: {
          organizationId,
          OR: [
            { signatureKey: { not: null } },
            { signedContractKey: { not: null } },
            { paymentReceiptKey: { not: null } },
          ],
        },
      }),
    ]);
    return { contracts, blockedDates, settings, contractsWithFiles: withFiles };
  }
}
