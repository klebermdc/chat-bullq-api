/**
 * Peças puras do backfill de `whatsapp_message_billing`
 * (`scripts/backfill-whatsapp-message-billing.ts`).
 *
 * Cursor sobre `webhook_events`, ordenado por `received_at`. Guarda o último instante lido + os ids já lidos NESSE instante: assim a
 * consulta seguinte é um range simples (`received_at >= cursor`, que usa o
 * índice) e eventos com timestamp empatado não são pulados nem repetidos.
 */
export interface BackfillCursor {
  receivedAt: Date | null;
  seenIds: string[];
}

export interface CursorEvent {
  id: string;
  receivedAt: Date;
}

export interface CursorWhere {
  receivedAt?: { gte: Date };
  id?: { notIn: string[] };
}

export const START_CURSOR: BackfillCursor = Object.freeze({
  receivedAt: null,
  seenIds: [],
}) as BackfillCursor;

export function cursorWhere(cursor: BackfillCursor, since: Date | null): CursorWhere {
  if (cursor.receivedAt) {
    return {
      receivedAt: { gte: cursor.receivedAt },
      id: { notIn: cursor.seenIds },
    };
  }
  return since ? { receivedAt: { gte: since } } : {};
}

/** `events` precisa vir ordenado por `receivedAt` ascendente. */
export function advanceCursor(
  cursor: BackfillCursor,
  events: CursorEvent[],
): BackfillCursor {
  if (events.length === 0) return cursor;
  const lastAt = events[events.length - 1].receivedAt;
  const idsAtLast = events
    .filter((event) => event.receivedAt.getTime() === lastAt.getTime())
    .map((event) => event.id);
  const isSameInstant = cursor.receivedAt?.getTime() === lastAt.getTime();
  return {
    receivedAt: lastAt,
    seenIds: isSameInstant ? [...cursor.seenIds, ...idsAtLast] : idsAtLast,
  };
}

export interface BackfillChannel {
  id: string;
  organizationId: string;
  /** `config.phoneNumberId` do canal oficial; null em canal sem o campo. */
  phoneNumberId: string | null;
}

/**
 * De qual canal (e portanto de qual organização) é um status do payload.
 * - Evento roteado: o canal do evento — exceto se o status é de outro número
 *   da mesma WABA (mesmo escopo por número do `parseWebhook`).
 * - Evento sem canal (UNROUTED): pelo `phone_number_id`, só se for inequívoco.
 */
export function resolveBackfillChannel(
  eventChannel: BackfillChannel | null,
  statusPhoneNumberId: string | null,
  channelsByPhoneNumberId: ReadonlyMap<string, BackfillChannel[]>,
): BackfillChannel | null {
  if (eventChannel) {
    const isOtherNumber =
      eventChannel.phoneNumberId != null &&
      statusPhoneNumberId != null &&
      eventChannel.phoneNumberId !== statusPhoneNumberId;
    return isOtherNumber ? null : eventChannel;
  }
  if (!statusPhoneNumberId) return null;
  const candidates = channelsByPhoneNumberId.get(statusPhoneNumberId) ?? [];
  return candidates.length === 1 ? candidates[0] : null;
}
