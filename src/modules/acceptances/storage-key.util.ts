const UPLOADS_PREFIX = '/api/v1/uploads/';

/**
 * Único prefixo que a leitura de voucher pode abrir. `POST messages/uploads/media`
 * — a rota que o modal usa para anexar — só produz `media/<data>/<32 hex>`.
 *
 * NÃO GENERALIZE ISSO. O bucket é compartilhado entre organizações e o PDF
 * assinado de um aceite mora em `acceptances/<data>/<id>.pdf`. Sem esta trava,
 * qualquer usuário autenticado de qualquer org que descubra um id de aceite lê
 * o aceite assinado de OUTRO tenant devolvido como "itens extraídos". O mesmo
 * vale para `inbound/`, `audio/` e `library/`, que não são anexos deste fluxo.
 *
 * O que sobra sob `media/` são chaves de 16 bytes aleatórios (`crypto.randomBytes`),
 * inadivinháveis, e que a própria API já serve sem autenticação em
 * `/api/v1/uploads/<chave>` — então o endpoint não concede nada além do que o
 * bucket já expõe a quem tem a URL.
 */
const ALLOWED_PREFIX = 'media/';

/**
 * Converte a URL pública devolvida por `POST messages/uploads/media` na chave
 * do objeto no storage. Devolve `null` para qualquer coisa que não seja um
 * upload nosso — o endpoint de extração recebe URL do cliente, e sem essa
 * checagem viraria um leitor de arquivo arbitrário.
 *
 * Isto é uma FRONTEIRA DE SEGURANÇA, não um formatador. O host de propósito não
 * é examinado: quem consegue forjar `https://evil.com/...` consegue forjar o
 * nosso host também, então checá-lo não protegeria nada. Quem protege é o
 * escopo por prefixo (`ALLOWED_PREFIX`) somado à leitura só do pathname.
 */
export function storageKeyFromUploadUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const raw = rawKeyFrom(url);
  if (raw === null) return null;

  // Decodifica ANTES das checagens, senão `%2e%2e%2f` passa por baixo do teste
  // de `..`. `decodeURIComponent` lança em sequência malformada.
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    return null;
  }

  // Decodificamos UMA vez de propósito: a chave devolvida tem que ser byte a
  // byte a chave do objeto, e decodificar em loop corromperia uma chave que
  // legitimamente contivesse `%`. Em troca, qualquer `%` que sobre é recusado —
  // uma chave nossa é `media/<data>/<32 hex><.ext>` e nunca tem `%`. É isso que
  // pega o double-encoding (`%252e%252e` → `%2e%2e`, que passaria batido pelo
  // teste literal de `..`).
  if (key.includes('%')) return null;

  if (!key || key.startsWith('/') || key.includes('..')) return null;
  if (!key.startsWith(ALLOWED_PREFIX)) return null;
  return key;
}

/**
 * Isola a parte que vira chave. Para qualquer coisa com esquema ou caminho
 * absoluto, a chave sai SÓ do `pathname` — nunca da query nem do fragmento,
 * senão `https://evil.com/redir?next=/api/v1/uploads/media/x.pdf` contrabandeia
 * a chave que o atacante quiser.
 */
function rawKeyFrom(url: string): string | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);

  if (hasScheme || url.startsWith('/')) {
    let pathname: string;
    try {
      // A base só resolve a forma relativa ("/api/v1/uploads/..."); URL absoluta
      // ignora a base. `new URL` lança em URL malformada.
      pathname = new URL(url, 'https://internal.invalid').pathname;
    } catch {
      return null;
    }
    if (!pathname.startsWith(UPLOADS_PREFIX)) return null;
    return pathname.slice(UPLOADS_PREFIX.length);
  }

  // Forma crua: a própria chave, sem host. Query/fragmento não fazem parte de
  // uma chave — se vier algo assim, não é chave nossa.
  if (url.includes('?') || url.includes('#')) return null;
  return url;
}
