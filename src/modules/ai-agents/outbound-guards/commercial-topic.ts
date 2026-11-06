// Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
/**
 * Detector de assunto comercial (valor, preço, desconto, parcela, Pix,
 * pagamento) na resposta da IA. Só regex, sem rede. Na OFP a Aline é SDR:
 * qualquer valor ou negociação é com o consultor, nem preço de tabela sai.
 *
 * Número sozinho NÃO é preço: data e hora com ponto ("dia 15.10 às 14.30"),
 * frequência ("2x ao dia") e porcentagem solta ("40% de visão") ficam de fora.
 * O número só conta com contexto de preço: moeda, parcela ("em 3x", "10x de")
 * ou "% off".
 */

const normalizar = (texto: string): string =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Triagem base: as palavras e formatos de preço que valem em qualquer direção. */
export function contemAssuntoComercialRestrito(texto: string): boolean {
  const normal = normalizar(texto);
  return (
    /\b(?:precos?|prec[io]+s?|custa\w*|custos?|quanto (?:fica|sai|e|seria)|descont\w*|negoci\w*|parcel\w*|pagamento\w*|pagar|pag[ao]s?|pix|boleto\w*|credito|debito|promoc\w*|oferta\w*|orcamento\w*|reais|gratis|gratuit\w*|barat\w*|caro|cobran\w*|cobra(?:m|r|mos)?|reembolso\w*|estorno\w*|investimentos?|mensalidades?|anuidades?|sem juros)\b/u.test(
      normal,
    ) ||
    // "valor" só quando é o do produto: "qual o valor?", "valor da consulta" — não "valor nutricional".
    /\bvalor(?:es)?(?=\s*(?:$|[?!.,;]|d[aeo]s?\b|total\b|final\b|a vista\b|pra\b|para\b|com desconto\b))/u.test(
      normal,
    ) ||
    /(?:r\$|us\$|\$|€|£)\s*\d/u.test(normal) ||
    /\b(?:em|ate|de)\s+\d{1,2}\s*x\b|\b\d{1,2}\s*x\s*(?:de\b|sem juros\b|no cartao\b)/u.test(normal) ||
    // "em 10 vezes" é parcela; "2 vezes ao dia" não chega aqui.
    /\b(?:em|ate)\s+\d{1,2}\s*vezes\b|\b\d{1,2}\s*vezes\s+no cartao\b/u.test(normal) ||
    /\b\d+(?:[.,]\d+)?\s*%\s*off\b/u.test(normal) ||
    // Vírgula com 2 casas é preço ("299,90"); com ponto é data/hora e não conta.
    /\b\d+,\d{2}\b/u.test(normal) ||
    /\b(?:fica|sai|apenas|somente|a partir de)\s*(?:por|em)?\s*\d/u.test(normal)
  );
}

/**
 * O que só a SAÍDA pega, além da triagem base: moeda sem número ("R$", "BRL"),
 * "valor" e "à vista" soltos, preço em espanhol e inglês, moeda por extenso,
 * decimal com ponto em posição de preço ("por 299.90"), cupom/abatimento,
 * parcela com valor depois ("10 vezes de 29", "3x 600", "12x150") e inteiro ou
 * milhar depois de verbo de preço ("faço 1800", "por 1.800"). "N vezes"
 * sozinho é frequência e não conta.
 */
const PRECO_SO_NA_SAIDA: readonly RegExp[] = [
  /(?:r|us)\$|€|£|\b(?:brl|usd|eur)\b/u,
  /\b(?:valor(?:es)?|a vista|descuent\w*|cuotas?|cuesta\w*|precios?|prices?|pricing|costs?|costos?|discounts?|dolar(?:es)?|dollars?|euros?)\b/u,
  /\b(?:por|cada)\s+\d+[.,]\d{2}\b|\b\d+[.,]\d{2}\s*(?:cada|por mes|ao mes|mensais)\b/u,
  /\b(?:honorarios?|abatimentos?|cupo(?:m|ns))\b|\b\d[\d.,]*\s*pesos\b/u,
  // Parcela com o valor colado: "10 vezes de 29", "3x 600", "12x de 150", "12x150".
  // Na forma "Nx" o valor precisa de 3 dígitos ou centavos: "foto 3x4" fica de fora.
  /\b\d{1,2}\s*vezes\s+de\s+(?:r\$\s*)?\d|\b\d{1,2}\s*x\s*(?:de\s+)?(?:r\$\s*)?(?:\d{3,}|\d+[.,]\d{2})(?![\d/:-])/u,
  // Parcela com espaço e sem "de": "10 vezes 99", "12x 50". O valor não pode vir
  // seguido de unidade ou frequência ("2x 30 minutos", "3 vezes 10 repetições").
  /\b\d{1,2}(?:\s*vezes|x)\s+(?:r\$\s*)?\d{2,}(?![\d/:-]|[.,]\d|\s*(?:x|cm|mm|m|metros?|kg|g|mg|ml|l|h|min|minutos?|horas?|dias?|semanas?|meses|repeti\w*|series?|comprimidos?|gotas?|ao dia|por (?:dia|semana)|diariamente)\b)/u,
  // Inteiro ou milhar depois de verbo/preposição de preço ("por 1.800", "faço
  // 1800"). Ano, hora, telefone, porcentagem e "mais de 1.000 clientes" ficam de fora.
  /(?:\b(?:por|faco|fazer|sai a|saindo a)|(?<!\b(?:mais|menos|cerca|acima|alem)\s)\bde)\s+(?!(?:19|20)\d{2}\b)(?:\d{1,3}(?:\.\d{3})+|\d{3,})(?![\d,]|[-/:.]\d|\s*%)/u,
];

/** Trava de saída: tudo o que a triagem base pega e mais o que só vale no envio. */
export function contemAssuntoComercialNaSaida(texto: string): boolean {
  if (contemAssuntoComercialRestrito(texto)) return true;
  const normal = normalizar(texto);
  return PRECO_SO_NA_SAIDA.some((re) => re.test(normal));
}
