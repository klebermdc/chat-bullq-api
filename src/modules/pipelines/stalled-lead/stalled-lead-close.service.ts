import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import { LostSaleService } from '../lost-sale.service';
import {
  buildNoReplyCloseQuery,
  type NoReplyConversationRow,
} from './stalled-lead-close.sql';

const SWEEP_INTERVAL_MS = 15 * 60_000;
/** Espera o boot assentar antes da 1ª rodada (deploy com sobreposição). */
const FIRST_SWEEP_DELAY_MS = 90_000;

/**
 * Finaliza como venda perdida "Não respondeu" o lead que mal conversou com a
 * IA e sumiu há 48h. Mesmo caminho do 👎 (LostSaleService.markLost): motivo na
 * conversa, card na coluna do motivo, funil de recuperação, conversa fechada.
 */
@Injectable()
export class StalledLeadCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StalledLeadCloseService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lostSale: LostSaleService,
  ) {}

  onModuleInit(): void {
    const first = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    const every = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    first.unref?.();
    every.unref?.();
    this.timers = [first, every];
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** Uma rodada. Devolve quantas conversas foram finalizadas. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const rows = await this.prisma.$queryRaw<NoReplyConversationRow[]>(
        buildNoReplyCloseQuery(),
      );
      let closed = 0;
      for (const row of rows) {
        if (await this.closeOne(row)) closed += 1;
      }
      if (rows.length > 0) {
        this.logger.log(`no_reply_close found=${rows.length} closed=${closed}`);
      }
      return closed;
    } catch (err) {
      this.logger.error(`no_reply_close falhou: ${(err as Error)?.message ?? err}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async closeOne(row: NoReplyConversationRow): Promise<boolean> {
    try {
      await this.lostSale.markLost(
        row.organization_id,
        row.conversation_id,
        { reason: 'NO_REPLY' },
        { userId: row.owner_id, role: OrgRole.OWNER, access: 'ALL' },
      );
      return true;
    } catch (err) {
      // Uma conversa com problema não pode travar as outras.
      this.logger.warn(
        `no_reply_close conv=${row.conversation_id} falhou: ${(err as Error)?.message ?? err}`,
      );
      return false;
    }
  }
}
