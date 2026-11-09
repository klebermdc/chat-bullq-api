import { LOST_REASONS, type LostReason } from './lost-sale.constants';

export interface StageOption {
  id: string;
  name: string;
  type: string;
}

/** "  Não  RESPONDEU " → "nao respondeu": sem acento, caixa ou espaço extra. */
export function normalizeStageName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Etapa de destino do 👎: a que tem o nome do motivo (o funil pode ter uma
 * coluna "Não respondeu", por exemplo); senão, a primeira LOST da lista.
 */
export function pickLostStage<T extends StageOption>(
  stages: readonly T[],
  reason: LostReason,
): T | null {
  const wanted = normalizeStageName(LOST_REASONS[reason]);
  return (
    stages.find((s) => normalizeStageName(s.name) === wanted) ??
    stages.find((s) => s.type === 'LOST') ??
    null
  );
}
