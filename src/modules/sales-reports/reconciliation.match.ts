/**
 * E5.2b — Heurística de reconciliação pedido↔card.
 *
 * Funções puras (sem I/O) que pontuam quão provável é um pedido do HUB
 * (`OfpSalesOrder`) pertencer ao contato de um card. Usadas pra sugerir
 * vínculos quando não houve match exato por nº do pedido.
 */

export interface OrderLike {
  telefoneCliente?: string | null;
  emailCliente?: string | null;
  cliente?: string | null;
  venda?: number | string | null;
}

export interface ContactLike {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}

/** Só-dígitos, tolerante (nunca lança). */
export function phoneDigits(raw?: string | null): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Telefones "batem" comparando os últimos 8 dígitos — assim ignoramos
 * divergências de DDI (55) e do 9º dígito, que são a maior fonte de falso
 * negativo em número brasileiro.
 */
export function phonesMatch(a?: string | null, b?: string | null): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (da.length < 8 || db.length < 8) return false;
  return da.slice(-8) === db.slice(-8);
}

export function emailsMatch(a?: string | null, b?: string | null): boolean {
  const na = (a || '').trim().toLowerCase();
  const nb = (b || '').trim().toLowerCase();
  return !!na && na === nb;
}

/** Minúsculas, sem acento, só letras/números/espaço, espaços colapsados. */
export function normalizeName(s?: string | null): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos (marcas combinantes)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nomes "parecidos": iguais após normalizar, ou compartilham ≥2 tokens de 3+
 * letras (nome + sobrenome) — evita casar só por "Maria" ou "Silva".
 */
export function namesSimilar(a?: string | null, b?: string | null): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(' ').filter((t) => t.length >= 3));
  const common = nb
    .split(' ')
    .filter((t) => t.length >= 3 && ta.has(t)).length;
  return common >= 2;
}

const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return isNaN(n) ? null : n;
};

export interface MatchResult {
  score: number;
  reasons: string[];
}

/**
 * Pontua um pedido contra um contato (+ valor do card, opcional).
 * Pesos: telefone 50, email 40, nome 20, valor 10 (suporte). Um único sinal
 * forte (telefone/email) já é match sugerível; nome+valor reforça.
 */
export function scoreOrderAgainstContact(
  order: OrderLike,
  contact: ContactLike,
  cardValue?: number | string | null,
): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  if (phonesMatch(order.telefoneCliente, contact.phone)) {
    score += 50;
    reasons.push('telefone');
  }
  if (emailsMatch(order.emailCliente, contact.email)) {
    score += 40;
    reasons.push('email');
  }
  if (namesSimilar(order.cliente, contact.name)) {
    score += 20;
    reasons.push('nome');
  }
  const venda = toNum(order.venda);
  const val = toNum(cardValue);
  if (venda != null && val != null && Math.abs(venda - val) < 0.01) {
    score += 10;
    reasons.push('valor');
  }

  return { score, reasons };
}
