/**
 * Backfill de `whatsapp_message_billing` a partir de `webhook_events.raw_payload`.
 *
 * Lê os webhooks já gravados do WhatsApp oficial
 * (`entry[].changes[].value.statuses[]`) e grava UMA linha por mensagem (wamid)
 * para cada status que traz `pricing`, com o mesmo mapeamento do caminho ao
 * vivo (`ChannelUsageService.recordMessageBilling`). `statusAt` = `timestamp`
 * do status. A organização vem do canal.
 *
 * Idempotente: upsert por (canal, wamid) — pode rodar de novo à vontade.
 *
 * Flags:
 *   --dry-run            só conta; não grava nada
 *   --since=YYYY-MM-DD   só eventos recebidos a partir desse dia (São Paulo)
 *
 * Uso local:
 *   npx ts-node -P tsconfig.json --transpile-only scripts/backfill-whatsapp-message-billing.ts --dry-run
 *
 * Uso em produção (a imagem não tem ts-node; o build já compila este arquivo):
 *   docker compose exec api node dist/scripts/backfill-whatsapp-message-billing.js --dry-run
 */
import { ChannelType, PrismaClient, WebhookEventStatus } from '@prisma/client';
import {
  advanceCursor,
  BackfillChannel,
  cursorWhere,
  resolveBackfillChannel,
  START_CURSOR,
} from '../src/modules/channel-usage/billing-backfill.util';
import {
  buildBillingUpsertArgs,
  extractBillingFromWebhookPayload,
} from '../src/modules/channel-usage/message-billing.mapper';
import { startOfZonedDay } from '../src/modules/channel-usage/zoned-day.util';

const BATCH_SIZE = 500;
const MAX_LOGGED_ERRORS = 20;
const DRY_RUN_FLAG = '--dry-run';
const SINCE_PREFIX = '--since=';

interface Options {
  dryRun: boolean;
  since: Date | null;
}

interface Stats {
  events: number;
  statusesWithPricing: number;
  skippedNoChannel: number;
  written: number;
  failed: number;
}

interface Scope {
  label: string;
  where: Record<string, unknown>;
  eventChannel: BackfillChannel | null;
}

const EMPTY_STATS: Stats = {
  events: 0,
  statusesWithPricing: 0,
  skippedNoChannel: 0,
  written: 0,
  failed: 0,
};

const prisma = new PrismaClient();

function parseOptions(argv: string[]): Options {
  let dryRun = false;
  let since: Date | null = null;
  for (const arg of argv) {
    if (arg === DRY_RUN_FLAG) {
      dryRun = true;
    } else if (arg.startsWith(SINCE_PREFIX)) {
      // startOfZonedDay lança se o dia não for YYYY-MM-DD válido.
      since = startOfZonedDay(arg.slice(SINCE_PREFIX.length));
    } else {
      throw new Error(
        `Argumento desconhecido: ${arg}. Use ${DRY_RUN_FLAG} e/ou ${SINCE_PREFIX}YYYY-MM-DD.`,
      );
    }
  }
  return { dryRun, since };
}

function addStats(a: Stats, b: Stats): Stats {
  return {
    events: a.events + b.events,
    statusesWithPricing: a.statusesWithPricing + b.statusesWithPricing,
    skippedNoChannel: a.skippedNoChannel + b.skippedNoChannel,
    written: a.written + b.written,
    failed: a.failed + b.failed,
  };
}

async function loadChannels(): Promise<BackfillChannel[]> {
  // Inclui canal com deletedAt: o histórico de cobrança dele continua valendo.
  const rows = await prisma.channel.findMany({
    where: { type: ChannelType.WHATSAPP_OFFICIAL },
    select: { id: true, organizationId: true, config: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => {
    const phoneNumberId = (row.config as Record<string, unknown> | null)
      ?.phoneNumberId;
    return {
      id: row.id,
      organizationId: row.organizationId,
      phoneNumberId: phoneNumberId ? String(phoneNumberId) : null,
    };
  });
}

function indexByPhoneNumberId(
  channels: BackfillChannel[],
): Map<string, BackfillChannel[]> {
  const index = new Map<string, BackfillChannel[]>();
  for (const channel of channels) {
    if (!channel.phoneNumberId) continue;
    index.set(channel.phoneNumberId, [
      ...(index.get(channel.phoneNumberId) ?? []),
      channel,
    ]);
  }
  return index;
}

/** Processa um lote de eventos. `seenMessages`/`errorLog` são acumuladores do run. */
async function processBatch(
  events: Array<{ id: string; rawPayload: unknown }>,
  scope: Scope,
  channelsByPhone: Map<string, BackfillChannel[]>,
  options: Options,
  seenMessages: Set<string>,
  errorLog: { logged: number },
): Promise<Stats> {
  let stats: Stats = { ...EMPTY_STATS, events: events.length };

  for (const event of events) {
    for (const found of extractBillingFromWebhookPayload(event.rawPayload)) {
      stats = { ...stats, statusesWithPricing: stats.statusesWithPricing + 1 };
      const channel = resolveBackfillChannel(
        scope.eventChannel,
        found.phoneNumberId,
        channelsByPhone,
      );
      if (!channel) {
        stats = { ...stats, skippedNoChannel: stats.skippedNoChannel + 1 };
        continue;
      }

      seenMessages.add(`${channel.id}|${found.row.externalMessageId}`);
      if (options.dryRun) continue;

      try {
        await prisma.whatsappMessageBilling.upsert(
          buildBillingUpsertArgs(channel.organizationId, channel.id, found.row),
        );
        stats = { ...stats, written: stats.written + 1 };
      } catch (err) {
        stats = { ...stats, failed: stats.failed + 1 };
        if (errorLog.logged < MAX_LOGGED_ERRORS) {
          errorLog.logged += 1;
          console.error(
            `  ! falha ao gravar wamid=${found.row.externalMessageId} evento=${event.id}: ${(err as Error).message}`,
          );
        }
      }
    }
  }
  return stats;
}

async function processScope(
  scope: Scope,
  channelsByPhone: Map<string, BackfillChannel[]>,
  options: Options,
  seenMessages: Set<string>,
  errorLog: { logged: number },
): Promise<Stats> {
  let total = EMPTY_STATS;
  let cursor = START_CURSOR;
  let batchNumber = 0;

  for (;;) {
    const events = await prisma.webhookEvent.findMany({
      where: { ...scope.where, ...cursorWhere(cursor, options.since) },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
      select: { id: true, receivedAt: true, rawPayload: true },
    });
    if (events.length === 0) break;

    batchNumber += 1;
    const stats = await processBatch(
      events,
      scope,
      channelsByPhone,
      options,
      seenMessages,
      errorLog,
    );
    total = addStats(total, stats);
    cursor = advanceCursor(cursor, events);

    console.log(
      `[${scope.label}] lote ${batchNumber}: eventos=${stats.events} ` +
        `status_com_pricing=${stats.statusesWithPricing} gravados=${stats.written} ` +
        `sem_canal=${stats.skippedNoChannel} falhas=${stats.failed} ` +
        `cursor=${cursor.receivedAt?.toISOString()}`,
    );
  }
  return total;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  console.log(
    `Backfill whatsapp_message_billing — modo=${options.dryRun ? 'DRY-RUN (não grava)' : 'GRAVAÇÃO'} ` +
      `desde=${options.since ? options.since.toISOString() : 'início'}`,
  );

  const channels = await loadChannels();
  const channelsByPhone = indexByPhoneNumberId(channels);
  console.log(`Canais WHATSAPP_OFFICIAL: ${channels.length}`);

  // Um escopo por canal (usa o índice channel_id + received_at) e um para os
  // eventos sem canal (UNROUTED), resolvidos pelo phone_number_id do payload.
  const scopes: Scope[] = [
    ...channels.map((channel) => ({
      label: `canal ${channel.id}`,
      where: { channelId: channel.id },
      eventChannel: channel,
    })),
    {
      label: 'sem canal',
      where: {
        channelId: null,
        channelType: ChannelType.WHATSAPP_OFFICIAL,
        status: WebhookEventStatus.UNROUTED,
      },
      eventChannel: null,
    },
  ];

  const seenMessages = new Set<string>();
  const errorLog = { logged: 0 };
  let total = EMPTY_STATS;
  for (const scope of scopes) {
    total = addStats(
      total,
      await processScope(scope, channelsByPhone, options, seenMessages, errorLog),
    );
  }

  console.log(
    `\nFim. eventos=${total.events} status_com_pricing=${total.statusesWithPricing} ` +
      `mensagens_distintas=${seenMessages.size} gravados=${total.written} ` +
      `sem_canal=${total.skippedNoChannel} falhas=${total.failed}` +
      (options.dryRun ? ' — DRY-RUN: nada foi gravado.' : ''),
  );
  if (total.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
