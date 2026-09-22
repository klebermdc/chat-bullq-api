-- Atualização da carteira Umbler (virada final). Chamado por atualizar-carteira.sh.
--
-- Variáveis psql: csv (caminho do CSV dentro do container) e aplicar (true
-- grava, false só mostra a prévia e desfaz tudo no ROLLBACK).
--
-- O que faz, numa transação só:
--   1. Lê o CSV novo (telefone em qualquer formato; linhas repetidas viram uma).
--   2. Atualiza contatos_legado: entra quem é novo, e quem já estava recebe
--      vendedor, etiquetas, nome e e-mail do arquivo novo. Ninguém é apagado.
--   3. Cria no Chat os contatos que faltam e aplica as etiquetas da planilha e
--      do vendedor. Vendedor sem usuário no Chat (ex.: Gabi) não dá etiqueta
--      nenhuma. Quem trocou de vendedor perde a etiqueta do vendedor antigo.
-- Não manda mensagem nem dispara automação.

\set ON_ERROR_STOP on
\pset footer off
BEGIN;

CREATE TEMP TABLE nova_raw (
  telefone TEXT, nome TEXT, email TEXT, vendedor TEXT,
  vendedores_extras TEXT, etapa TEXT, tags TEXT
);
-- \copy não aceita variável no caminho: COPY do servidor, que lê o arquivo de
-- dentro do container do Postgres (o .sh copia o CSV para lá).
SELECT format('COPY nova_raw FROM %L WITH (FORMAT csv, HEADER true, ENCODING %L)', :'csv', 'UTF8') \gexec

-- Telefone padronizado: '+' e só dígitos, como a carteira guarda. Sem '+' e
-- com 10-11 dígitos é número brasileiro sem o 55 (mesma regra do normalizePhone).
CREATE TEMP VIEW nova_tel AS
  SELECT r.*,
         '+' || CASE
                  WHEN btrim(coalesce(r.telefone, '')) NOT LIKE '+%' AND length(d.digits) IN (10, 11)
                    THEN '55' || d.digits
                  ELSE d.digits
                END AS tel
  FROM nova_raw r
  CROSS JOIN LATERAL (
    SELECT regexp_replace(regexp_replace(coalesce(r.telefone, ''), '\D', '', 'g'), '^0+', '') AS digits
  ) d;

CREATE TEMP TABLE nova AS
  SELECT DISTINCT ON (tel)
         tel AS telefone,
         nullif(btrim(nome), '') AS nome,
         nullif(btrim(email), '') AS email,
         nullif(btrim(vendedor), '') AS vendedor,
         nullif(btrim(vendedores_extras), '') AS vendedores_extras,
         nullif(btrim(etapa), '') AS etapa,
         nullif(btrim(tags), '') AS tags
  FROM nova_tel
  WHERE length(tel) BETWEEN 11 AND 16
  ORDER BY tel;

DO $$
DECLARE
  lidas int := (SELECT count(*) FROM nova_raw);
  validas int := (SELECT count(*) FROM nova);
BEGIN
  IF validas < 1000 THEN
    RAISE EXCEPTION 'Arquivo com só % telefones válidos (de % linhas). Confira o CSV antes de seguir.', validas, lidas;
  END IF;
END $$;

\echo
\echo '=== PRÉVIA DO ARQUIVO NOVO ==='
SELECT (SELECT count(*) FROM nova_raw) AS linhas_no_arquivo,
       (SELECT count(*) FROM nova) AS telefones_validos_unicos,
       (SELECT count(*) FROM nova_raw) - (SELECT count(*) FROM nova) AS repetidas_ou_invalidas;

SELECT count(*) FILTER (WHERE a.telefone IS NULL) AS novos_na_carteira,
       count(*) FILTER (WHERE a.telefone IS NOT NULL AND a.vendedor IS DISTINCT FROM n.vendedor) AS trocaram_de_vendedor,
       count(*) FILTER (WHERE a.telefone IS NOT NULL AND a.vendedor IS NOT DISTINCT FROM n.vendedor) AS mesmo_vendedor,
       (SELECT count(*) FROM contatos_legado c WHERE NOT EXISTS (SELECT 1 FROM nova x WHERE x.telefone = c.telefone)) AS sumiram_do_arquivo_mas_ficam
FROM nova n LEFT JOIN contatos_legado a ON a.telefone = n.telefone;

\echo
\echo '=== Clientes por vendedor no arquivo novo ==='
\echo '    mapeado = f: vendedor sem usuário no Chat. Os clientes dele vão para a distribuição normal e ficam sem etiqueta'
SELECT n.vendedor, count(*) AS clientes,
       EXISTS (SELECT 1 FROM contatos_legado_vendedores m WHERE m.vendedor = n.vendedor) AS mapeado
FROM nova n GROUP BY 1 ORDER BY 2 DESC;

-- Quem trocou de vendedor (para trocar a etiqueta do vendedor no contato).
CREATE TEMP TABLE trocou AS
  SELECT n.telefone, a.vendedor AS antigo, n.vendedor AS novo
  FROM nova n JOIN contatos_legado a ON a.telefone = n.telefone
  WHERE a.vendedor IS DISTINCT FROM n.vendedor;

-- 2) Carteira
INSERT INTO contatos_legado (telefone, nome, email, vendedor, vendedores_extras, etapa, tags)
  SELECT telefone, nome, email, vendedor, vendedores_extras, etapa, tags FROM nova
ON CONFLICT (telefone) DO UPDATE SET
  nome = excluded.nome,
  email = excluded.email,
  vendedor = excluded.vendedor,
  vendedores_extras = excluded.vendedores_extras,
  etapa = excluded.etapa,
  tags = excluded.tags,
  importado_em = now();

-- 3) Contatos do Chat (mesma lógica da importação de 21/09)
CREATE TEMP TABLE org AS
  SELECT organization_id AS id FROM user_organizations
  WHERE user_id = 'cmr5450mr0000qjb0hpli38np' LIMIT 1;

CREATE TEMP TABLE leg AS
  SELECT telefone,
         substr(telefone, 2) AS d,
         CASE
           WHEN substr(telefone, 2) ~ '^55[1-9][1-9]9[6-9][0-9]{7}$'
             THEN '55' || substr(telefone, 4, 2) || substr(telefone, 7)
           WHEN substr(telefone, 2) ~ '^55[1-9][1-9][6-9][0-9]{7}$'
             THEN '55' || substr(telefone, 4, 2) || '9' || substr(telefone, 6)
         END AS alt,
         nullif(btrim(regexp_replace(nome, '[\u200E\u200F\u202A-\u202E\uFEFF]', '', 'g')), '') AS nome,
         nullif(lower(btrim(email)), '') AS email,
         vendedor,
         tags
  FROM contatos_legado;

CREATE TEMP TABLE cphone AS
  SELECT c.id, regexp_replace(c.phone, '\D', '', 'g') AS digits, c.created_at
  FROM contacts c, org
  WHERE c.organization_id = org.id AND c.deleted_at IS NULL AND c.phone IS NOT NULL;

CREATE TEMP TABLE leg_contact (telefone TEXT PRIMARY KEY, contact_id TEXT NOT NULL, novo BOOLEAN NOT NULL);
INSERT INTO leg_contact
  SELECT DISTINCT ON (telefone) telefone, id, false
  FROM (
    SELECT l.telefone, cp.id, cp.created_at FROM leg l JOIN cphone cp ON cp.digits = l.d
    UNION ALL
    SELECT l.telefone, cp.id, cp.created_at FROM leg l JOIN cphone cp ON cp.digits = l.alt
  ) x
  ORDER BY telefone, created_at;

CREATE TEMP TABLE novos AS
  SELECT l.*, gen_random_uuid()::text AS id
  FROM leg l
  WHERE NOT EXISTS (SELECT 1 FROM leg_contact lc WHERE lc.telefone = l.telefone)
    AND NOT (length(l.d) = 12 AND EXISTS (SELECT 1 FROM leg l2 WHERE l2.d = l.alt));

INSERT INTO contacts (id, organization_id, name, phone, email, metadata, updated_at)
  SELECT n.id, org.id, n.nome, n.d, n.email,
         jsonb_build_object('origem', 'umbler', 'vendedor_umbler', n.vendedor),
         now()
  FROM novos n, org;

INSERT INTO leg_contact SELECT telefone, id, true FROM novos;
INSERT INTO leg_contact
  SELECT l.telefone, lc.contact_id, lc.novo
  FROM leg l JOIN leg_contact lc ON lc.telefone = '+' || l.alt
  WHERE length(l.d) = 12
ON CONFLICT DO NOTHING;

-- Troca de vendedor: tira do contato a etiqueta do vendedor antigo.
DELETE FROM contact_tags ct
USING trocou tr, leg_contact lc, contatos_legado_vendedores m, users u, tags t
WHERE lc.telefone = tr.telefone
  AND ct.contact_id = lc.contact_id
  AND m.vendedor = tr.antigo AND u.id = m.user_id
  AND t.id = ct.tag_id AND lower(t.name) = lower(btrim(u.name));

CREATE TEMP TABLE etiqueta_nova AS
  SELECT DISTINCT ON (lower(nome)) nome
  FROM (
    SELECT btrim(t) AS nome, count(*) AS n
    FROM leg, unnest(string_to_array(tags, '|')) AS t
    WHERE btrim(t) <> ''
      AND EXISTS (SELECT 1 FROM contatos_legado_vendedores m WHERE m.vendedor = leg.vendedor)
    GROUP BY 1
    UNION ALL
    SELECT btrim(u.name), 0
    FROM contatos_legado_vendedores m JOIN users u ON u.id = m.user_id
  ) x
  ORDER BY lower(nome), n DESC, nome;

INSERT INTO tags (id, organization_id, name)
  SELECT gen_random_uuid()::text, org.id, e.nome
  FROM etiqueta_nova e, org
  WHERE NOT EXISTS (
    SELECT 1 FROM tags t WHERE t.organization_id = org.id AND lower(t.name) = lower(e.nome)
  );

INSERT INTO contact_tags (contact_id, tag_id)
  SELECT DISTINCT lc.contact_id, t.id
  FROM leg l
  JOIN leg_contact lc ON lc.telefone = l.telefone
  CROSS JOIN LATERAL unnest(string_to_array(l.tags, '|')) AS raw
  JOIN org ON true
  JOIN tags t ON t.organization_id = org.id AND lower(t.name) = lower(btrim(raw))
  WHERE btrim(raw) <> ''
    AND EXISTS (SELECT 1 FROM contatos_legado_vendedores m WHERE m.vendedor = l.vendedor)
ON CONFLICT DO NOTHING;

INSERT INTO contact_tags (contact_id, tag_id)
  SELECT DISTINCT lc.contact_id, t.id
  FROM leg l
  JOIN leg_contact lc ON lc.telefone = l.telefone
  JOIN contatos_legado_vendedores m ON m.vendedor = l.vendedor
  JOIN users u ON u.id = m.user_id
  JOIN org ON true
  JOIN tags t ON t.organization_id = org.id AND lower(t.name) = lower(btrim(u.name))
ON CONFLICT DO NOTHING;

\echo
\echo '=== RESULTADO ==='
SELECT (SELECT count(*) FROM novos) AS contatos_criados_agora,
       (SELECT count(*) FROM trocou) AS etiqueta_de_vendedor_trocada,
       (SELECT count(*) FROM contatos_legado) AS carteira_total;

SELECT l.vendedor, count(DISTINCT lc.contact_id) AS contatos,
       count(DISTINCT lc.contact_id) FILTER (
         WHERE EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                       JOIN contatos_legado_vendedores m ON m.vendedor = l.vendedor
                       JOIN users u ON u.id = m.user_id
                       WHERE ct.contact_id = lc.contact_id AND lower(t.name) = lower(btrim(u.name)))
       ) AS com_etiqueta_do_vendedor
FROM leg l JOIN leg_contact lc ON lc.telefone = l.telefone
GROUP BY 1 ORDER BY 2 DESC;

\if :aplicar
  COMMIT;
  \echo '>>> GRAVADO.'
\else
  ROLLBACK;
  \echo '>>> PRÉVIA: nada foi gravado. Para gravar, rode de novo com --aplicar.'
\endif
