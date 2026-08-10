/**
 * Passageiro nominal de um item. Ingresso de parque é nominal: o nome errado
 * (ou inventado) só aparece no portão, com a família parada na fila. Por isso
 * `name` é obrigatório e `birthDate` é opcional — voucher que não escreve o
 * nascimento fica sem, nunca com um valor deduzido.
 */
export interface AcceptancePassenger {
  name: string;
  /** Data de nascimento como está escrita no voucher, sem reformatar. */
  birthDate?: string;
}

export interface AcceptanceItem {
  description: string;
  qty?: number;
  date?: string;
  note?: string;
  /** Localizador / nº de confirmação da operadora, quando veio de um voucher. */
  ref?: string;
  /**
   * Passageiros nominais deste item. Costuma bater com `qty`, mas os dois
   * campos são independentes de propósito: se o voucher disser "2 Adulto(s)" e
   * listar 3 nomes, registramos os dois como estão escritos. Reconciliar seria
   * deduzir, e deduzir é exatamente o que este extrator não pode fazer.
   */
  passengers?: AcceptancePassenger[];
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

/**
 * Desfecho do disparo de UMA mensagem do "Pedido enviado".
 *
 * `queued` significa ENFILEIRADO, não entregue: `MessagesService.send` persiste
 * a Message, joga na fila `outbound-messages` e volta. Quem decide se aquilo
 * chega ao cliente é o worker (`pipeline/outbound-message.processor`) — a trava
 * de janela 24h/72h roda LÁ e marca a Message como FAILED depois que este
 * `send` já resolveu. Por isso o `messageId`: o desfecho real mora na Message
 * (`status` QUEUED/SENT/FAILED + `failedReason`), e sem esse id não há como
 * ligar o aceite ao que de fato saiu.
 */
export interface DeliverySendResult {
  queued: boolean;
  /** Id da Message criada. Ausente quando nem chegou a enfileirar. */
  messageId?: string;
  /** Motivo curto e legível quando nem enfileirou. O texto cru fica no log. */
  error?: string;
}

/** O mesmo desfecho, por voucher. */
export interface VoucherSendResult extends DeliverySendResult {
  filename: string;
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
  /**
   * Snapshot da política de cancelamento aceita junto com o termo. `null`
   * quando a org não tinha política configurada na criação — inclusive nos
   * aceites anteriores à feature, que não devem exibir o bloco.
   */
  policyText: string | null;
  signedAt: string | null;
  signerName: string | null;
  pdfUrl: string | null;
  /** Vouchers entregues, para o cliente conferir antes de assinar. */
  vouchers: VoucherRef[];
  orderRef: string | null;
}
