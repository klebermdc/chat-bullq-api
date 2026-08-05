import { Injectable, Logger } from '@nestjs/common';
import { EmailMessageStatus, EmailSubscriberStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SubscribersService } from '../email-audience/subscribers.service';
import { SuppressionService } from '../email-audience/suppression.service';

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    click?: { link?: string };
    bounce?: { type?: string };
    [k: string]: unknown;
  };
}

@Injectable()
export class EmailEventsService {
  private readonly logger = new Logger(EmailEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscribers: SubscribersService,
    private readonly suppression: SuppressionService,
  ) {}

  /**
   * Aplica um evento do Resend.
   *
   * Grava SEMPRE o evento cru primeiro — webhook chega fora de ordem e
   * duplicado, e sem esse log depurar entregabilidade vira adivinhação.
   */
  async apply(organizationId: string, event: ResendEvent): Promise<void> {
    const providerId = event.data?.email_id;
    if (!providerId) {
      this.logger.warn(`evento ${event.type} sem email_id — ignorado`);
      return;
    }
    const occurredAt = event.created_at ? new Date(event.created_at) : new Date();
    const url = event.data?.click?.link ?? null;

    const message = await this.prisma.emailMessage.findUnique({ where: { providerId } });

    await this.prisma.emailEvent.create({
      data: {
        organizationId,
        messageId: message?.id ?? null,
        providerId,
        type: event.type,
        url,
        payload: event as any,
        occurredAt,
      },
    });

    if (!message) return;

    switch (event.type) {
      case 'email.delivered':
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: EmailMessageStatus.DELIVERED, deliveredAt: occurredAt },
        });
        return;

      case 'email.opened':
        // Não mexe em `status`: abrir não é etapa do funil de entrega, e
        // sobrescrever DELIVERED perderia informação.
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: { openCount: { increment: 1 }, openedAt: message.openedAt ?? occurredAt },
        });
        return;

      case 'email.clicked':
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            clickCount: { increment: 1 },
            firstClickedAt: message.firstClickedAt ?? occurredAt,
          },
        });
        return;

      case 'email.bounced': {
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: EmailMessageStatus.BOUNCED,
            failedReason: `bounce ${event.data?.bounce?.type ?? 'desconhecido'}`,
          },
        });
        const status = this.suppression.statusForBounce(event.data?.bounce?.type);
        if (status && message.subscriberId) {
          await this.subscribers.suppress(
            message.subscriberId,
            message.organizationId,
            status,
            'bounce permanente',
          );
        }
        return;
      }

      case 'email.complained':
        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: EmailMessageStatus.COMPLAINED },
        });
        if (message.subscriberId) {
          await this.subscribers.suppress(
            message.subscriberId,
            message.organizationId,
            EmailSubscriberStatus.COMPLAINED,
            'marcou como spam',
          );
        }
        return;

      default:
        this.logger.debug(`evento ${event.type} registrado sem ação`);
    }
  }

  /**
   * Ponto de entrada do webhook. Resolve a organização a partir da mensagem —
   * a conta do Resend é global e o payload não traz organização.
   */
  async applyByProviderId(event: ResendEvent): Promise<void> {
    const providerId = event.data?.email_id;
    if (!providerId) {
      this.logger.warn(`evento ${event.type} sem email_id — ignorado`);
      return;
    }
    const message = await this.prisma.emailMessage.findUnique({
      where: { providerId },
      select: { organizationId: true },
    });
    // Mesmo sem mensagem conhecida registramos o evento, para ele não sumir:
    // o webhook pode chegar antes do nosso próprio update gravar o providerId.
    return this.apply(message?.organizationId ?? '', event);
  }
}
