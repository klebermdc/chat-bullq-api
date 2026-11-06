/**
 * Link de compra/pagamento na resposta da IA (parte da trava "sem assunto
 * comercial"). Barra a URL quando:
 *  - algum pedaço do endereço (host, caminho ou query) é palavra de compra:
 *    checkout, pagamento, pagar, payment, pay, pix, boleto, carrinho, cart,
 *    comprar, compra, fatura, invoice; ou
 *  - o host é de plataforma de pagamento conhecida (Kirvano, Hotmart, ...).
 * Casa por PEDAÇO inteiro (separado por ponto, barra, hífen...), então
 * "display" ou "compayment" não contam. Link do site que não é de compra passa.
 */

const PURCHASE_TOKENS: ReadonlySet<string> = new Set([
  'checkout',
  'pagamento',
  'pagamentos',
  'pagar',
  'payment',
  'payments',
  'pay',
  'pix',
  'boleto',
  'carrinho',
  'cart',
  'comprar',
  'compra',
  'fatura',
  'invoice',
]);

/** Hosts que só servem para cobrar (o checkout da Kirvano já aparece na recuperação de vendas). */
const PAYMENT_HOSTS: readonly string[] = [
  'kirvano.com',
  'hotmart.com',
  'eduzz.com',
  'kiwify.com.br',
  'kiwify.app',
  'mercadopago.com',
  'mercadopago.com.br',
  'pagseguro.uol.com.br',
  'stripe.com',
  'asaas.com',
  'paypal.com',
  'pagar.me',
];

const URL_NO_TEXTO = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

function lerUrl(bruta: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(bruta) ? bruta : `https://${bruta}`);
  } catch {
    return null;
  }
}

function ehHostDePagamento(host: string): boolean {
  return PAYMENT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

function ehLinkDeCompra(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (ehHostDePagamento(host)) return true;
  const endereco = `${host} ${decodeURIComponent(url.pathname)} ${url.search}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return endereco.split(/[^a-z0-9]+/).some((pedaco) => PURCHASE_TOKENS.has(pedaco));
}

/**
 * O texto tem algum link? Com `blockCommercialTalk` a Aline é só SDR e não
 * manda link nenhum (site, cotação, pagamento) — decisão do Kleber em 06/11/2026.
 */
export function contemLink(texto: string): boolean {
  return [...(texto ?? '').matchAll(URL_NO_TEXTO)].length > 0;
}

/** O texto tem algum link de compra ou pagamento? */
export function contemLinkDeCompra(texto: string): boolean {
  return [...(texto ?? '').matchAll(URL_NO_TEXTO)]
    .map((m) => lerUrl(m[0]))
    .some((url) => url !== null && ehLinkDeCompra(url));
}
