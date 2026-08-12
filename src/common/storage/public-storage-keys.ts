/**
 * Quais objetos do storage a rota `/api/v1/uploads` pode servir sem sessão.
 *
 * Essa rota é aberta de propósito: provedores externos (WhatsApp/Uazapi) baixam
 * a mídia por URL para entregar ao cliente, e o Safari precisa de Range em
 * `<audio>`. O problema nunca foi ela ser pública — foi ela ser pública para
 * *qualquer* chave, incluindo o PDF assinado do aceite, que carrega assinatura,
 * IP e dado pessoal e ficava baixável por quem tivesse a URL, de qualquer
 * organização.
 *
 * A lista abaixo é de permissão, não de bloqueio. Fecha por padrão: um tipo de
 * arquivo novo criado amanhã não vaza sem alguém vir aqui e liberar de propósito.
 */
const PUBLIC_PREFIXES = ['audio/', 'media/', 'uploads/'] as const;

export function isPubliclyServableKey(key: string): boolean {
  if (!key) return false;
  // Travessia de caminho anula qualquer prefixo: `media/../acceptances/x.pdf`
  // começa com um prefixo liberado e termina em outro lugar.
  if (key.includes('..')) return false;
  return PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix));
}
