export interface ExtractedPark {
  nome: string;
  dias: number;
  data: string; // ISO date (YYYY-MM-DD)
}

export interface ExtractedCart {
  adults: number;
  children: number;
  startDate: string; // ISO date
  endDate: string; // ISO date
  parks: ExtractedPark[];
  totalValue: number;
  currency: string;
}
