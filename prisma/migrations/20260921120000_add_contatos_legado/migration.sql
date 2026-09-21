-- Carteira legada de contatos (planilha de vendedores, ~43 mil linhas).
--
-- Quando um lead novo chega, o pipeline de entrada consulta esta tabela pelo
-- telefone. Se o contato já era de um vendedor, a conversa vai direto para ele
-- e pula a triagem da Aline e a fila "Distribuir".
--
-- Os dados entram por \copy (fora da migration). O telefone fica no formato da
-- planilha: '+' seguido só de dígitos (ex.: +5585999998888).

CREATE TABLE IF NOT EXISTS "contatos_legado" (
  "telefone"          TEXT PRIMARY KEY,
  "nome"              TEXT,
  "email"             TEXT,
  "vendedor"          TEXT,
  "vendedores_extras" TEXT,
  "etapa"             TEXT,
  "tags"              TEXT,
  "importado_em"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "contatos_legado_vendedor_idx"
  ON "contatos_legado" ("vendedor");

-- Nome do vendedor na planilha ("Renata", "Carol"...) -> usuário do sistema.
-- Preenchido à mão depois de conferir o mapeamento; vendedor sem linha aqui
-- segue a distribuição normal.
CREATE TABLE IF NOT EXISTS "contatos_legado_vendedores" (
  "vendedor" TEXT PRIMARY KEY,
  "user_id"  TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE
);

-- Busca o dono legado de um telefone em qualquer formato ("+55 (85) 9...",
-- "5585...", "@s.whatsapp.net" já sem sufixo). O WhatsApp entrega muitos
-- celulares BR sem o 9º dígito (12 dígitos): nesse caso tenta também a forma
-- com o 9 depois do DDD. Casamento exato tem preferência.
CREATE OR REPLACE FUNCTION buscar_vendedor_legado(p_telefone TEXT)
RETURNS TABLE (vendedor TEXT, etapa TEXT, tags TEXT)
LANGUAGE sql
STABLE
AS $$
  WITH n AS (
    SELECT regexp_replace(COALESCE(p_telefone, ''), '\D', '', 'g') AS d
  )
  SELECT c.vendedor, c.etapa, c.tags
  FROM contatos_legado c, n
  WHERE n.d <> ''
    AND c.telefone IN (
      '+' || n.d,
      CASE
        WHEN length(n.d) = 12 AND n.d LIKE '55%'
        THEN '+' || substr(n.d, 1, 4) || '9' || substr(n.d, 5)
      END
    )
  ORDER BY (c.telefone = '+' || n.d) DESC
  LIMIT 1;
$$;
