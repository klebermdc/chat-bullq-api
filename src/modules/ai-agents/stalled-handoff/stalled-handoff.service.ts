import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../../database/prisma.service';
import { TransferToHumanTool } from '../tools/builtin/transfer-to-human.tool';
import {
  STALL_HOURS,
  buildStalledHandoffQuery,
  type StalledConversationRow,
} from './stalled-handoff.sql';

const SWEEP_INTERVAL_MS = 15 * 60_000;
/** Espera o boot assentar antes da 1ª rodada (deploy com sobreposição). */
const FIRST_SWEEP_DELAY_MS = 60_000;

export const STALLED_HANDOFF_REASON =
  `Cliente parou de responder há mais de ${STALL_HOURS}h durante a qualificação ` +
  'e a IA não transferiu. Enviado à fila pelo vigia.';

/**
 * Vigia de leads parados: a IA (modo SDR) respondeu, o cliente sumiu e
 * ninguém transferiu. Sem isso o lead fica fora de "Com a IA" e de "Na fila"
 * e morre quando a janela fecha (caso Ana Paula, 11/11/2026).
 *
 * Mesmo padrão do AgentRunJanitorService: só Prisma + timer. A transferência
 * reaproveita o TransferToHumanTool (dedupe, card em Distribuir, pendência).
 */
@Injectable()
export class StalledHandoffService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StalledHandoffService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfer: TransferToHumanTool,
  ) {}

  onModuleInit(): void {
    const first = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    const every = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // Não segura o event loop / shutdown por causa dos timers.
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** Uma rodada. Devolve quantos leads foram para a fila. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows = await this.prisma.$queryRaw<StalledConversationRow[]>(
        buildStalledHandoffQuery(),
      );
      let queued = 0;
      for (const row of rows) {
        if (await this.queueOne(row)) queued += 1;
      }
      if (rows.length > 0) {
        this.logger.log(`stalled_handoff found=${rows.length} queued=${queued}`);
      }
      return queued;
    } catch (err) {
      this.logger.error(
        `stalled_handoff falhou: ${(err as Error)?.message ?? err}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async queueOne(row: StalledConversationRow): Promise<boolean> {
    try {
      await this.transfer.queueStalledHandoff(
        {
          organizationId: row.organization_id,
          conversationId: row.conversation_id,
          contactId: row.contact_id,
          channelId: row.channel_id,
          agentId: row.agent_id,
          runId: row.run_id,
        },
        STALLED_HANDOFF_REASON,
      );
      return true;
    } catch (err) {
      // Uma conversa com problema não pode travar as outras.
      this.logger.warn(
        `stalled_handoff conv=${row.conversation_id} falhou: ${(err as Error)?.message ?? err}`,
      );
      return false;
    }
  }
}
