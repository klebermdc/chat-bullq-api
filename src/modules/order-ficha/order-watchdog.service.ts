import { Injectable, Logger } from '@nestjs/common';
import { OrderFichaStatus } from '@prisma/client';
import { OrderFichaRepository } from './order-ficha.repository';
import { OrderAlertService } from './order-alert.service';
import { OrderFichaSettingsService } from './order-ficha-settings.service';
import { ConversationMessagesReader } from './conversation-messages.reader';
import { Divergence } from './order-ficha.types';

/**
 * Watchdog de demora sem carrinho: varre as fichas que registraram um pedido
 * mas ainda não receberam carrinho e, quando o prazo (default 24h, por org)
 * expira, registra uma divergência `DELAY_NO_CART` e dispara o alerta.
 *
 * `sweep(now)` é um método público puro (recebe o relógio por parâmetro) pra
 * ser dirigido diretamente no teste unitário; o agendamento fica na
 * plumbing BullMQ (`OrderWatchdogProcessor`), no mesmo padrão dos outros
 * watchdogs do projeto (recovery-watchdog, routing/watchdog).
 */
@Injectable()
export class OrderWatchdogService {
  private readonly logger = new Logger(OrderWatchdogService.name);

  constructor(
    private readonly repo: OrderFichaRepository,
    private readonly alert: OrderAlertService,
    private readonly settings: OrderFichaSettingsService,
    private readonly convos: ConversationMessagesReader,
  ) {}

  async sweep(now: Date): Promise<void> {
    const candidates = await this.repo.findDelayCandidates();
    for (const f of candidates) {
      try {
        const existing = ((f.divergences as any[]) ?? []) as Divergence[];
        const already = existing.some((d) => d?.kind === 'DELAY_NO_CART');
        if (already) continue;

        const hours = await this.settings.delayHoursFor(f.organizationId ?? '');
        if (!f.requestedAt) continue;
        const elapsedH =
          (now.getTime() - new Date(f.requestedAt).getTime()) / 3_600_000;
        if (elapsedH < hours) continue;

        const div: Divergence = {
          kind: 'DELAY_NO_CART',
          message: `Cliente pediu há ${Math.floor(elapsedH)}h e ainda não recebeu carrinho`,
          detail: { requestedAt: f.requestedAt, prazoHoras: hours },
          detectedAt: now.toISOString(),
        };

        const channelId = await this.convos.channelIdFor(f.conversationId);
        await this.repo.updateDivergences(
          f.conversationId,
          [...existing, div],
          OrderFichaStatus.DIVERGENT,
          undefined,
        );
        await this.alert.raise(f.conversationId, channelId, [div]);
        this.logger.log(
          `order_watchdog_delay_alert conversation=${f.conversationId} elapsedH=${Math.floor(elapsedH)}`,
        );
      } catch (err) {
        this.logger.warn(
          `order_watchdog_candidate_failed conversation=${f.conversationId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
