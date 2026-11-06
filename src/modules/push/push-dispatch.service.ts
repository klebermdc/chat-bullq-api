import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { buildPushPayload } from './push-payload';
import { DEFAULT_PUSH_TIMEZONE, preferenceAllowsPush } from './push-policy';
import { PushSenderService } from './push-sender.service';
import { PushIntent } from './push.types';

export type DispatchOutcome = 'disabled' | 'online' | 'not_member' | 'muted' | 'sent' | 'no_device';

export interface DispatchInput {
  recipientId: string;
  organizationId: string;
  type: NotificationType;
  intent: PushIntent;
}

/**
 * Decide se o aviso vira push no aparelho do vendedor:
 *  1. sem chaves VAPID → nada (push desligado);
 *  2. Sendtur aberto nesta empresa → nada: vale o som do próprio app;
 *  3. fora da empresa → nada;
 *  4. preferência do tipo com push desligado ou no Não-Perturbe → nada;
 *  5. senão envia, só com nome do cliente + frase fixa.
 */
@Injectable()
export class PushDispatchService {
  private readonly logger = new Logger(PushDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly sender: PushSenderService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    if (!this.sender.isEnabled()) return 'disabled';
    if (await this.realtime.hasOpenSession(input.recipientId, input.organizationId)) return 'online';

    const [membership, pref, org] = await Promise.all([
      this.prisma.userOrganization.findUnique({
        where: { userId_organizationId: { userId: input.recipientId, organizationId: input.organizationId } },
        select: { userId: true },
      }),
      this.prisma.notificationPreference.findUnique({
        where: {
          userId_organizationId_type: {
            userId: input.recipientId,
            organizationId: input.organizationId,
            type: input.type,
          },
        },
        select: { type: true, browserPush: true, dndStart: true, dndEnd: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { aiTimezone: true },
      }),
    ]);
    if (!membership) return 'not_member';

    const timeZone = org?.aiTimezone || DEFAULT_PUSH_TIMEZONE;
    if (!preferenceAllowsPush(pref ?? undefined, new Date(), timeZone)) return 'muted';

    const result = await this.sender.sendToUser(
      input.recipientId,
      input.organizationId,
      buildPushPayload(input.intent),
    );
    this.logger.log(
      `push ${input.intent.kind} user=${input.recipientId} enviados=${result.sent} mortos=${result.gone} falhas=${result.failed}`,
    );
    return result.sent > 0 ? 'sent' : 'no_device';
  }
}
