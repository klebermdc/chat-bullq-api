import type { Prisma } from '@prisma/client';
import { LOST_REASONS, type LostReason } from './lost-sale.constants';

/**
 * Funil "Recuperação de perdidas": criado sozinho no primeiro uso, uma coluna
 * por motivo de venda perdida + Recuperado + Descartado.
 *
 * Todas as etapas são NORMAL de propósito. A venda de verdade é o card do
 * funil de vendas; se "Recuperado" fosse WON, a venda contaria duas vezes nos
 * relatórios e iria um segundo Purchase pra Meta.
 */
export const LOST_RECOVERY_PIPELINE_KEY = 'lost_recovery';

export const RECOVERED_STAGE_KEY = 'recovered';
export const DISCARDED_STAGE_KEY = 'discarded';

// Só as cores que o kanban do web conhece (kanban-column.tsx).
const REASON_STAGE_COLORS: Record<LostReason, string> = {
  NO_REPLY: 'amber',
  JUST_BROWSING: 'blue',
  COMPETITOR: 'violet',
  PRICE: 'pink',
  TRIP_CANCELLED: 'zinc',
  OTHER: 'zinc',
};

/** Rótulo curto da coluna (o motivo completo fica no card). */
const REASON_STAGE_NAMES: Record<LostReason, string> = {
  NO_REPLY: 'Não respondeu',
  JUST_BROWSING: 'Curioso',
  COMPETITOR: 'Concorrente',
  PRICE: 'Preço',
  TRIP_CANCELLED: 'Desistiu',
  OTHER: 'Outro',
};

export const LOST_RECOVERY_STAGES: ReadonlyArray<{
  key: string;
  name: string;
  color: string;
}> = [
  ...(Object.keys(LOST_REASONS) as LostReason[]).map((reason) => ({
    key: reason,
    name: REASON_STAGE_NAMES[reason],
    color: REASON_STAGE_COLORS[reason],
  })),
  { key: RECOVERED_STAGE_KEY, name: 'Recuperado', color: 'green' },
  { key: DISCARDED_STAGE_KEY, name: 'Descartado', color: 'red' },
];

/**
 * Filtro de card que deixa de fora o funil de recuperação. Usado onde o código
 * procura "o card da conversa" no funil de vendas (Ganho, aceite, cadência…).
 * O OR com `key: null` é necessário: `key <> x` no SQL descarta as linhas nulas,
 * e quase todo funil tem key nula.
 */
export const NOT_LOST_RECOVERY: Prisma.CardWhereInput = {
  pipeline: {
    OR: [{ key: null }, { key: { not: LOST_RECOVERY_PIPELINE_KEY } }],
  },
};
