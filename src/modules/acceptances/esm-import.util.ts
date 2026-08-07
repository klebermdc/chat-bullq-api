/**
 * `pdfjs-dist` é ESM puro e este projeto compila para CommonJS
 * (`tsconfig.json` → `"module": "commonjs"`). Um `await import(...)` escrito
 * direto seria transpilado pelo TypeScript para `require()`, que falha em
 * runtime com ERR_REQUIRE_ESM. O `new Function` esconde o import do
 * transpilador, preservando o `import()` dinâmico nativo do Node.
 *
 * Mora num arquivo próprio porque dois utilitários dependem dele
 * (`pdf-text.util` e `pdf-render.util`) e o truque é sutil demais para ser
 * copiado: um `await import()` "arrumado" por engano derruba a leitura de
 * voucher só em produção, nunca no `tsc`.
 */
export const esmImport = new Function('m', 'return import(m)') as (
  m: string,
) => Promise<any>;
