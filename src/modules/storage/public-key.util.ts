/**
 * Prefixos que `/api/v1/uploads/<chave>` pode servir SEM autenticação.
 *
 * A rota precisa ser pública para dois leitores que não têm sessão nenhuma:
 *
 *   1. os servidores da Meta — o adapter oficial manda `link: mediaUrl` no
 *      payload e a Meta faz o GET para baixar a mídia que estamos enviando;
 *   2. o navegador, via `<img>` e `<audio>`, que não mandam header
 *      `Authorization`.
 *
 * O que ela NÃO pode fazer é servir o bucket inteiro. O bucket é único para
 * todas as organizações e a chave não carrega escopo de tenant, então
 * `acceptances/<data>/<id>.pdf` — o PDF do aceite assinado, com nome do
 * cliente, IP e assinatura — era baixável sem sessão por qualquer pessoa.
 *
 * Allowlist e não denylist de propósito: prefixo novo nasce FECHADO. Bloquear
 * `acceptances/` resolveria o caso conhecido de hoje e deixaria o próximo
 * prefixo privado vazando até alguém lembrar dele. Mesma escolha do
 * FEATURE_MAP do RBAC.
 */
const PREFIXOS_PUBLICOS = [
  'media/', // anexos enviados pelo operador
  'audio/', // notas de voz (OGG/Opus)
  'inbound/', // mídia recebida, re-hospedada a partir da Meta/provedor
  'playback/', // rendição M4A para Safari/iOS
] as const;

/**
 * A chave pode ser servida pela rota pública de uploads?
 *
 * A barra final em cada prefixo é obrigatória: `startsWith('media')` sem ela
 * abriria `mediaX/` junto, de graça.
 */
export function isPubliclyServable(key: string): boolean {
  const chave = key.trim();
  if (!chave) return false;
  // Travessia de diretório: barra a chave inteira em vez de tentar normalizar.
  // Vale tanto para `../` quanto para a forma percent-encoded, que o handler
  // decodifica antes de chegar aqui.
  if (chave.includes('..')) return false;
  return PREFIXOS_PUBLICOS.some((prefixo) => chave.startsWith(prefixo));
}
