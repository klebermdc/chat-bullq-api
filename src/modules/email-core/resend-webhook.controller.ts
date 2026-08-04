import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  Logger,
  RawBodyRequest,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationType, OrgRole } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailEventsService, ResendEvent } from './email-events.service';
import { verifySvixSignature } from './svix-signature.util';
import { EmailConfig, loadEmailConfig } from './email.config';
import { ResendWebhookThrottleGuard } from './resend-webhook-throttle.guard';

/**
 * Assinatura errada é um estado CONTÍNUO (secret desatualizado), não um
 * evento novo a cada requisição. Sem cooldown, cada tentativa rejeitada
 * dispara `alertOwners()` de novo — com o throttle guard permitindo até
 * ~60 req/10s, isso vira uma notificação a cada webhook pro resto da vida
 * do secret errado. Avisa uma vez, repete a cada 15 minutos enquanto o
 * problema persistir.
 */
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

@ApiTags('Webhooks')
@Controller('webhooks/resend')
@UseGuards(ResendWebhookThrottleGuard)
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);
  private readonly config: EmailConfig;
  private lastAlertAt = 0;

  constructor(
    private readonly events: EmailEventsService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    config?: EmailConfig,
  ) {
    this.config = config ?? loadEmailConfig(process.env);
  }

  @Post()
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe eventos de entrega do Resend' })
  async handle(@Req() req: RawBodyRequest<Request>, @Headers() headers: Record<string, string>) {
    // O `main.ts` já sobe o Nest com `{ rawBody: true }`. Reserializar o body
    // quebraria a assinatura.
    const raw = req.rawBody?.toString('utf8') ?? '';

    if (!verifySvixSignature(raw, headers, this.config.webhookSecret)) {
      // Fail-loud. Assinatura inválida em silêncio foi o que derrubou o
      // inbound quando o App Secret estava errado: o sintoma some e ninguém
      // percebe.
      this.logger.error('webhook Resend com assinatura inválida — evento descartado');
      await this.alertOwners().catch((err) =>
        this.logger.error(`falha ao alertar OWNER: ${err.message}`),
      );
      throw new UnauthorizedException('assinatura inválida');
    }

    let event: ResendEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      this.logger.error('webhook Resend com corpo não-JSON');
      throw new UnauthorizedException('corpo inválido');
    }

    await this.events.applyByProviderId(event);
    return { received: true };
  }

  /**
   * A conta do Resend é ÚNICA por deployment — `RESEND_WEBHOOK_SECRET` é uma
   * variável global, não por organização. Uma assinatura inválida derruba o
   * webhook para TODAS as organizações de uma vez, não só uma; por isso o
   * alerta vai para o OWNER de cada org, não de uma org específica. É o
   * mesmo tipo de falha-em-silêncio que já derrubou o inbound do WhatsApp
   * (App Secret errado) — aqui não pode se repetir.
   *
   * Falha ao notificar uma org não deve impedir o alerta às demais, por isso
   * o catch é por org.
   *
   * Cooldown: só reconsulta orgs e reenvia notificações se já se passaram
   * `ALERT_COOLDOWN_MS` desde o último alerta — repetir a cada requisição
   * rejeitada vira ruído, não sinal.
   */
  private async alertOwners(): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertAt < ALERT_COOLDOWN_MS) {
      this.logger.warn('webhook Resend com assinatura inválida dentro do cooldown — alerta não repetido');
      return;
    }
    this.lastAlertAt = now;

    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      await this.notifications
        .notifyOrgAgents({
          organizationId: org.id,
          roles: [OrgRole.OWNER],
          type: NotificationType.SYSTEM,
          title: 'Webhook de email recusado',
          body: 'Chegou um webhook do Resend com assinatura inválida. Confira RESEND_WEBHOOK_SECRET.',
        })
        .catch((err) => this.logger.error(`falha ao alertar org ${org.id}: ${err.message}`));
    }
  }
}
