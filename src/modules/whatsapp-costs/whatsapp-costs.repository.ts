import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_TIMEZONE } from '../response-sla/response-sla.rules';
import type { BilledMessageRow } from './breakdown.aggregate';

export interface CostChannel {
  id: string;
  name: string;
  wabaId: string | null;
  token: string | null;
}

/** Folga para status que chegam depois do fim do período. */
const STATUS_LAG_MS = 60 * 60_000;

function readCreds(config: unknown): { wabaId: string | null; token: string | null } {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { wabaId: str(cfg.businessAccountId) ?? str(cfg.wabaId), token: str(cfg.accessToken) };
}

/** Só leitura. O token nunca sai deste módulo. */
@Injectable()
export class WhatsappCostsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async orgTimezone(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiTimezone: true },
    });
    return org?.aiTimezone || DEFAULT_TIMEZONE;
  }

  async listChannels(organizationId: string): Promise<CostChannel[]> {
    const rows = await this.prisma.channel.findMany({
      where: { organizationId, type: ChannelType.WHATSAPP_OFFICIAL, deletedAt: null, isActive: true },
      select: { id: true, name: true, config: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, ...readCreds(r.config) }));
  }

  /**
   * Mensagens que a Meta marcou como cobradas (status com pricing.billable),
   * cruzadas com quem enviou. Um wamid conta uma vez.
   */
  async billedMessages(channelId: string, start: Date, end: Date): Promise<BilledMessageRow[]> {
    const until = new Date(end.getTime() + STATUS_LAG_MS);
    return this.prisma.$queryRaw<BilledMessageRow[]>`
      WITH billed AS (
        SELECT DISTINCT ON (s->>'id') s->>'id' AS wamid, upper(s->'pricing'->>'category') AS category
        FROM webhook_events w,
          jsonb_array_elements(w.raw_payload->'entry') e,
          jsonb_array_elements(e->'changes') c,
          jsonb_array_elements(c->'value'->'statuses') s
        WHERE w.channel_id = ${channelId}
          AND w.received_at >= ${start} AND w.received_at < ${until}
          AND (s->'pricing'->>'billable') = 'true'
        ORDER BY s->>'id', w.received_at
      )
      SELECT b.category AS "category",
        m.conversation_id AS "conversationId",
        m.sender_id AS "senderId",
        m.sender_name AS "senderName",
        u.name AS "userName",
        (m.metadata ? 'aiAgentId') AS "isAi",
        coalesce((m.metadata->>'automated')::boolean, false) AS "isAutomated",
        CASE WHEN m.type = 'TEMPLATE' THEN m.content->>'name' END AS "templateName",
        CASE WHEN m.type = 'TEMPLATE' THEN (
          SELECT mt.category FROM message_templates mt
          WHERE mt.channel_id = ${channelId} AND mt.name = m.content->>'name'
          LIMIT 1
        ) END AS "templateCategory"
      FROM billed b
      JOIN messages m ON m.external_id = b.wamid
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.created_at >= ${start} AND m.created_at < ${end}
    `;
  }
}
