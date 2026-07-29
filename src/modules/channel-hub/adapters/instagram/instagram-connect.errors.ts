/**
 * Slugs estáveis que viajam na URL de volta pro web. A mensagem crua da Meta
 * fica só no log — ela muda sem aviso e às vezes carrega dado sensível.
 */
export type InstagramConnectSlug =
  | 'state_invalido'
  | 'code_expirado'
  | 'permissao_negada'
  | 'sem_conta_business'
  | 'falha_inscricao'
  | 'erro_interno';

export class InstagramConnectError extends Error {
  constructor(
    readonly slug: InstagramConnectSlug,
    message: string,
  ) {
    super(message);
    this.name = 'InstagramConnectError';
  }
}
