/** Chaves de arquivo no MinIO: nunca saem na resposta, só viram booleanos. */
interface FileKeys {
  signatureKey?: string | null;
  signedContractKey?: string | null;
  paymentReceiptKey?: string | null;
  acceptancePdfKey?: string | null;
}

export interface FileFlags {
  hasSignature: boolean;
  hasSignedContract: boolean;
  hasPaymentReceipt: boolean;
  hasAcceptancePdf: boolean;
}

function fileFlags(c: FileKeys): FileFlags {
  return {
    hasSignature: !!c.signatureKey,
    hasSignedContract: !!c.signedContractKey,
    hasPaymentReceipt: !!c.paymentReceiptKey,
    hasAcceptancePdf: !!c.acceptancePdfKey,
  };
}

/** Senha do Planejador cifrada: só sai decifrada pela rota de credenciais. */
interface SecretFields {
  planejadorPasswordEnc?: string | null;
}

/** Linha da listagem: troca as chaves pelos booleanos e nunca leva a senha cifrada. */
export function toListItem<T extends FileKeys & SecretFields>(row: T) {
  const {
    signatureKey: _s, signedContractKey: _c, paymentReceiptKey: _p, acceptancePdfKey: _a,
    planejadorPasswordEnc: _pw, ...rest
  } = row;
  return { ...rest, ...fileFlags(row) };
}

/**
 * Detalhe (já escopado): tudo menos user agent, chaves cruas e senha cifrada,
 * mais os booleanos. Do Planejador saem só `planejadorSyncedAt` e `planejadorError`.
 */
export function toDetailView<T extends FileKeys & { clientUserAgent?: string | null }>(contract: T) {
  const { clientUserAgent: _ua, ...rest } = contract;
  return toListItem(rest);
}
