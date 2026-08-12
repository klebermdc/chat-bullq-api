import { Injectable } from '@nestjs/common';
import { AdConnectionStatus, AdProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

/** Nunca inclui `accessTokenEnc`. O token não sai do servidor. */
export const CONNECTION_PUBLIC_SELECT = {
  id: true,
  provider: true,
  externalAccountId: true,
  accountName: true,
  currency: true,
  timezoneName: true,
  status: true,
  tokenExpiresAt: true,
  lastSyncAt: true,
  lastSyncError: true,
  createdAt: true,
} satisfies Prisma.AdAccountConnectionSelect;

@Injectable()
export class AdConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllPublic(organizationId: string) {
    return this.prisma.adAccountConnection.findMany({
      where: { organizationId },
      select: CONNECTION_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOnePublic(organizationId: string, id: string) {
    return this.prisma.adAccountConnection.findFirst({
      where: { id, organizationId },
      select: CONNECTION_PUBLIC_SELECT,
    });
  }

  /** Com o token cifrado. Só para o processor. */
  findOneWithToken(id: string) {
    return this.prisma.adAccountConnection.findUnique({ where: { id } });
  }

  findActive() {
    return this.prisma.adAccountConnection.findMany({
      where: { status: AdConnectionStatus.ACTIVE },
      select: { id: true },
    });
  }

  upsert(data: {
    organizationId: string;
    provider: AdProvider;
    externalAccountId: string;
    accountName: string | null;
    currency: string | null;
    timezoneName: string | null;
    businessId: string | null;
    accessTokenEnc: string;
    tokenScopes: string[];
    tokenExpiresAt: Date | null;
    connectedByUserId: string | null;
  }) {
    const { organizationId, provider, externalAccountId, ...rest } = data;
    return this.prisma.adAccountConnection.upsert({
      where: {
        organizationId_provider_externalAccountId: {
          organizationId,
          provider,
          externalAccountId,
        },
      },
      create: { organizationId, provider, externalAccountId, ...rest },
      update: { ...rest, status: AdConnectionStatus.ACTIVE, lastSyncError: null },
      select: CONNECTION_PUBLIC_SELECT,
    });
  }

  markSynced(id: string, at: Date) {
    return this.prisma.adAccountConnection.update({
      where: { id },
      data: { lastSyncAt: at, lastSyncError: null },
    });
  }

  markFailed(id: string, message: string, status?: AdConnectionStatus) {
    return this.prisma.adAccountConnection.update({
      where: { id },
      data: { lastSyncError: message.slice(0, 500), ...(status ? { status } : {}) },
    });
  }

  delete(organizationId: string, id: string) {
    return this.prisma.adAccountConnection.deleteMany({ where: { id, organizationId } });
  }
}
