export const PARKS = [
  { id: 'magic-kingdom', label: 'Magic Kingdom' },
  { id: 'epcot', label: 'EPCOT' },
  { id: 'hollywood-studios', label: 'Hollywood Studios' },
  { id: 'animal-kingdom', label: 'Animal Kingdom' },
  { id: 'epic-universe', label: 'EPIC Universe' },
  { id: 'universal-studios', label: 'Universal Studios' },
  { id: 'islands-adventure', label: "Islands of Adventure" },
  { id: 'seaworld', label: 'SeaWorld' },
  { id: 'busch-gardens', label: 'Busch Gardens' },
] as const;

export type ParkId = (typeof PARKS)[number]['id'];
export const PARK_IDS: readonly string[] = PARKS.map((p) => p.id);

export const DATES_TO_BE_DEFINED_TEXT = 'Datas a definir';

/** Arquivos que o operador anexa ao contrato. */
export const CONTRACT_FILE_KINDS = ['signed-contract', 'payment-receipt'] as const;
export type ContractFileKind = (typeof CONTRACT_FILE_KINDS)[number];

export const ALLOWED_FILE_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Lembrete de Multipass: hóspede Disney compra 7 dias antes, os demais 3. */
export const MULTIPASS_DAYS_BEFORE_DISNEY_GUEST = 7;
export const MULTIPASS_DAYS_BEFORE_DEFAULT = 3;
export const MULTIPASS_REMINDER_WINDOW_DAYS = 14;
