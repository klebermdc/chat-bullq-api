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

/** Ingressos de parque — o carrinho de sempre, agora com o discriminante. */
export interface ExtractedParksProposal extends ExtractedCart {
  kind: 'PARKS';
}

/**
 * Qualquer coisa que NÃO é ingresso de parque (aluguel de carro, hotel,
 * transfer…). Não tem parques, datas de viagem nem passageiros: vai ao cliente
 * como um título e as condições, uma por linha, do jeito que o modelo leu.
 */
export interface ExtractedOtherProposal {
  kind: 'OTHER';
  title: string;
  lines: string[];
  /** Valor à vista (Pix); 0 = não informado. */
  totalValue: number;
  currency: string;
}

export type ExtractedProposal = ExtractedParksProposal | ExtractedOtherProposal;

export type ProposalKind = ExtractedProposal['kind'];

/** Print anexado à proposta, como `POST /messages/uploads/media` devolveu. */
export interface ProposalImage {
  url: string;
  mimeType: string;
  filename?: string;
  size?: number;
}

/** Bytes de um print prontos para a chamada de visão (base64 sem prefixo). */
export interface ProposalImageData {
  mediaType: string;
  data: string;
}

/**
 * Coluna `details` (Json) da proposta. `title`/`lines` só existem em OTHER;
 * `images` existe nos dois tipos quando o atendente anexou prints.
 */
export interface ProposalDetails {
  title?: string;
  lines?: string[];
  images?: ProposalImage[];
}
