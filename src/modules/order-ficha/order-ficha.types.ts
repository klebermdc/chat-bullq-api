export interface OrderItem {
  produto: string;
  quantidade: number;
  tipo?: 'adulto' | 'crianca' | null;
}

export interface ExtractedOrder {
  items: OrderItem[];
  travelDatesText: string | null;
  travelStart: string | null;
  travelEnd: string | null;
}

export type DivergenceKind =
  | 'ITEM_MISMATCH'
  | 'TRAVEL_DATE_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'DELAY_NO_CART';

export interface Divergence {
  kind: DivergenceKind;
  message: string;
  detail: Record<string, unknown>;
  detectedAt: string;
}
