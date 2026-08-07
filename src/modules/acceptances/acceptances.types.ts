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

/**
 * O que o cliente manda ao criar o aceite: o arquivo, sem o hash. O `sha256`
 * é de propósito o único campo que o cliente não fornece — hash vindo do
 * navegador não prova nada, quem calcula é o servidor lendo o objeto.
 */
export type VoucherInput = Omit<VoucherRef, 'sha256'>;

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
  /** Vouchers entregues, para o cliente conferir antes de assinar. */
  vouchers: VoucherRef[];
  orderRef: string | null;
}
