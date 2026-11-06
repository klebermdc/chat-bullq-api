import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** Inscrição parada há mais que isso (app não abriu) é descartada no envio. */
export const STALE_SUBSCRIPTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionInput {
  userId: string;
  organizationId: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
  userAgent: string | null;
}

export interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

@Injectable()
export class PushSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava ou renova a inscrição deste navegador. O `endpoint` é único: se o
   * aparelho trocou de pessoa ou de empresa, a linha passa para quem está
   * logado agora (o aparelho antigo deixa de receber o aviso do outro).
   */
  async upsert(input: SubscriptionInput): Promise<void> {
    const now = new Date();
    const fields = {
      userId: input.userId,
      organizationId: input.organizationId,
      p256dhKey: input.p256dhKey,
      authKey: input.authKey,
      userAgent: input.userAgent,
      lastSeenAt: now,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { ...fields, endpoint: input.endpoint },
      update: fields,
    });
  }

  /** Só apaga a inscrição se ela for de quem pede (logout deste aparelho). */
  async removeForUser(userId: string, endpoint: string): Promise<number> {
    const res = await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return res.count;
  }

  async removeById(id: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { id } });
  }

  /**
   * As inscrições vivas da pessoa nesta empresa. Antes de listar, descarta as
   * paradas há 30 dias: aparelho que ninguém abre não segue recebendo aviso.
   */
  async listActive(userId: string, organizationId: string, now: Date): Promise<StoredSubscription[]> {
    const cutoff = new Date(now.getTime() - STALE_SUBSCRIPTION_DAYS * DAY_MS);
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, organizationId, lastSeenAt: { lt: cutoff } },
    });
    return this.prisma.pushSubscription.findMany({
      where: { userId, organizationId },
      select: { id: true, endpoint: true, p256dhKey: true, authKey: true },
    });
  }
}
