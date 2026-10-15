import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
}

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)];
}

const UNIQUE_CONFLICT_MESSAGE = 'Conflito de chave única no lote (token de aceite ou contrato duplicado)';

/** Traduz P2002 em 409 genérico (sem ecoar valores); outros erros propagam. */
async function runBatch<T>(batch: Promise<T>): Promise<T> {
  try {
    return await batch;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(UNIQUE_CONFLICT_MESSAGE);
    }
    throw err;
  }
}

/**
 * Evidência de aceite: nunca apagada nem trocada depois de existir no Sendtur.
 * No update só preenche lacuna (valor atual null); o resto dos campos é
 * operacional e segue o Lovable até a virada.
 */
const EVIDENCE_FIELDS = [
  'acceptanceToken',
  'acceptedAt',
  'clientIp',
  'clientUserAgent',
  'signatureKey',
  'signedContractKey',
  'paymentReceiptKey',
] as const;

type EvidenceField = (typeof EVIDENCE_FIELDS)[number];
type EvidenceSnapshot = { legacyId: string | null } & Record<EvidenceField, unknown>;

function withoutFilledEvidence<T extends Record<string, unknown>>(
  update: T,
  current: EvidenceSnapshot | undefined,
): Partial<T> {
  if (!current) return update;
  const filled = new Set(EVIDENCE_FIELDS.filter((f) => current[f] !== null && current[f] !== undefined));
  return Object.fromEntries(Object.entries(update).filter(([k]) => !filled.has(k as EvidenceField))) as Partial<T>;
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
    const current = await this.prisma.contract.findMany({
      where: { organizationId, legacyId: { in: mapped.map((m) => m.legacyId as string) } },
      select: {
        legacyId: true,
        acceptanceToken: true,
        acceptedAt: true,
        clientIp: true,
        clientUserAgent: true,
        signatureKey: true,
        signedContractKey: true,
        paymentReceiptKey: true,
      },
    });
    const byLegacyId = new Map<string, EvidenceSnapshot>(
      current.map((c: EvidenceSnapshot) => [c.legacyId as string, c]),
    );
    await runBatch(
      this.prisma.$transaction(
        mapped.map((data) => {
          const { organizationId: _org, legacyId, ...fields } = data;
          return this.prisma.contract.upsert({
            where: { organizationId_legacyId: { organizationId, legacyId: legacyId as string } },
            create: data,
            update: withoutFilledEvidence(fields, byLegacyId.get(legacyId as string)),
          });
        }),
      ),
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
    await runBatch(
      this.prisma.$transaction(
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
    if (!(extensionOf(legacyPath) in CONTENT_TYPES)) {
      throw new BadRequestException('Extensão de arquivo não permitida');
    }
    let key: string;
    try {
      key = storageKeyFor(organizationId, legacyPath);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const existing = await this.storage.stat(key);
    if (existing) {
      if (existing.size === buffer.byteLength) return { key, status: 'exists' as const };
      throw new ConflictException('Arquivo já existe com conteúdo diferente; não foi sobrescrito');
    }
    await this.storage.put(key, buffer, contentTypeFor(legacyPath));
    return { key, status: 'stored' as const };
  }

  async status(organizationId: string) {
    const [contracts, blockedDates, settings, withFiles] = await Promise.all([
      this.prisma.contract.count({ where: { organizationId, legacyId: { not: null } } }),
      this.prisma.contractBlockedDate.count({ where: { organizationId } }),
      this.prisma.contractSettings.count({ where: { organizationId } }),
      this.prisma.contract.count({
        where: {
          organizationId,
          legacyId: { not: null },
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
