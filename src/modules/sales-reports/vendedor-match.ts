/**
 * Vínculo pelo nome: o mesmo critério da tabela "Vendas por vendedor", que
 * agrupa pelo texto `vendedor` gravado em cada pedido do OFP Hub.
 * Usado só quando o e-mail do login não tem perfil vinculado no OFP Hub.
 */

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Devolve o vendedor cujo nome bate com o nome do usuário — primeiro pelo
 * nome completo, depois pelo primeiro nome. Mais de um candidato = ambíguo,
 * devolve null (melhor bloquear do que mostrar vendas de outra pessoa).
 */
export function matchVendedorByName(userName: string | null | undefined, vendedores: readonly string[]): string | null {
  if (!userName) return null;
  const full = normalizeName(userName);
  if (!full) return null;
  const firstName = full.split(' ')[0];
  const distinct = [...new Set(vendedores.filter((v) => v && v.trim()))];

  for (const target of [full, firstName]) {
    const hits = distinct.filter((v) => normalizeName(v) === target);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}
