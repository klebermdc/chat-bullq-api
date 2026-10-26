/**
 * Motivos de venda perdida. O código vai para `conversations.lost_reason` e
 * `cards.closed_reason`; o rótulo aparece na mensagem de sistema do histórico.
 * O web tem a mesma lista (features/pipelines/lib/lost-reasons.ts) — ao mudar
 * aqui, mude lá.
 */
export const LOST_REASONS = {
  NO_REPLY: 'Não respondeu',
  JUST_BROWSING: 'Curioso / só pesquisando',
  COMPETITOR: 'Comprou com concorrente',
  PRICE: 'Preço / fora do orçamento',
  TRIP_CANCELLED: 'Desistiu da viagem',
  OTHER: 'Outro',
} as const;

export type LostReason = keyof typeof LOST_REASONS;

export const LOST_REASON_CODES = Object.keys(LOST_REASONS) as LostReason[];

/** "Outro" sem explicação não serve para relatório nenhum. */
export const LOST_REASONS_REQUIRING_NOTE: readonly LostReason[] = ['OTHER'];

export const LOST_NOTE_MAX_LENGTH = 500;
