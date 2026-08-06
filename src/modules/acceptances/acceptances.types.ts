export interface AcceptanceItem {
  description: string;
  qty?: number;
  date?: string;
  note?: string;
  /** Localizador / nº de confirmação da operadora, quando veio de um voucher. */
  ref?: string;
}

/** Voucher entregue junto com o aceite. */
export interface VoucherRef {
  url: string;
  filename: string;
  size: number;
  /** SHA-256 do arquivo, calculado no backend. Prova que é aquele arquivo. */
  sha256: string;
}

/** O que o extrator devolve a partir do texto de UM voucher. */
export interface ExtractedVoucher {
  items: AcceptanceItem[];
  orderRef: string | null;
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
