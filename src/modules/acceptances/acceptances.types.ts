export interface AcceptanceItem {
  description: string;
  qty?: number;
  date?: string;
  note?: string;
}

/** O que a página pública pode ver (sem PII interna). */
export interface PublicAcceptanceView {
  status: 'PENDING' | 'SIGNED' | 'EXPIRED' | 'CANCELED';
  organizationName: string;
  items: AcceptanceItem[];
  termText: string;
  signedAt: string | null;
  signerName: string | null;
  pdfUrl: string | null;
}
