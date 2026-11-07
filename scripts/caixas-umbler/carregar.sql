-- Caixas da Umbler -> conversas abertas no Sendtur. Chamado por carregar.sh.
--
-- Variáveis psql: csv (caminho dentro do container) e aplicar (true grava,
-- false mostra a prévia e desfaz tudo no ROLLBACK).
--
-- Para cada linha do CSV (uma conversa aberta ou no Esperando da Umbler):
--   - já importada antes (metadata.umbler_chat_id)      -> pula (rodar de novo é seguro)
--   - o cliente já tem conversa aberta no Sendtur        -> não mexe no dono nem na aba;
--                                                          só acrescenta as etiquetas da Umbler
--                                                          (menos as de vendedor)
--   - senão                                              -> cria a conversa com o mesmo
--                                                          vendedor, etiquetas e aba da Umbler
-- Contato que falta é criado; vínculo contato-canal que falta também.
-- Não manda mensagem nem dispara automação (não enfileira evento no outbox).

\set ON_ERROR_STOP on
\pset footer off
BEGIN;
-- As colunas de data são "timestamp without time zone" em UTC (padrão Prisma).
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE cx_raw (
  umbler_chat_id TEXT, telefone TEXT, nome TEXT, canal_id TEXT, aba TEXT, vendedor TEXT,
  setor TEXT, etiquetas_conversa TEXT, etiquetas_contato TEXT, ultima_entrada TEXT,
  janela_meta TEXT, ultima_msg TEXT, criada_em TEXT
);
SELECT format('COPY cx_raw FROM %L WITH (FORMAT csv, HEADER true, ENCODING %L)', :'csv', 'UTF8') \gexec

-- Comparação de nomes sem acento e sem caixa (BARBARA = Bárbara).
CREATE FUNCTION pg_temp.sem_acento(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(lower(btrim(coalesce(t, ''))),
                   'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')
$$;

CREATE TEMP TABLE cx AS
  SELECT r.umbler_chat_id,
         d.digits AS d,
         CASE
           WHEN d.digits ~ '^55[1-9][1-9]9[6-9][0-9]{7}$' THEN '55' || substr(d.digits, 3, 2) || substr(d.digits, 6)
           WHEN d.digits ~ '^55[1-9][1-9][6-9][0-9]{7}$'  THEN '55' || substr(d.digits, 3, 2) || '9' || substr(d.digits, 5)
         END AS alt,
         nullif(btrim(regexp_replace(r.nome, '[‎‏‪-‮﻿]', '', 'g')), '') AS nome,
         ch.id AS channel_id,
         ch.organization_id AS org_id,
         r.aba,
         nullif(btrim(r.vendedor), '') AS vendedor,
         nullif(btrim(r.setor), '') AS setor,
         coalesce(r.etiquetas_conversa, '') AS etiquetas_conversa,
         coalesce(r.etiquetas_contato, '') AS etiquetas_contato,
         nullif(r.ultima_entrada, '')::timestamptz AS ultima_entrada,
         nullif(r.janela_meta, '')::timestamptz AS janela_meta,
         coalesce(nullif(r.ultima_msg, '')::timestamptz, now()) AS ultima_msg,
         coalesce(nullif(r.criada_em, '')::timestamptz, now()) AS criada_em
  FROM cx_raw r
  CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(r.telefone, ''), '\D', '', 'g') AS digits) d
  JOIN channels ch ON ch.id = r.canal_id AND ch.deleted_at IS NULL
  WHERE r.aba IN ('entrada', 'esperando') AND length(d.digits) BETWEEN 10 AND 15;

DO $$
BEGIN
  IF (SELECT count(*) FROM cx) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha válida no CSV (canal inexistente ou arquivo vazio).';
  END IF;
  IF (SELECT count(DISTINCT org_id) FROM cx) > 1 THEN
    RAISE EXCEPTION 'O CSV mistura canais de organizações diferentes.';
  END IF;
END $$;

\echo
\echo '=== ARQUIVO ==='
SELECT (SELECT count(*) FROM cx_raw) AS linhas_no_arquivo,
       (SELECT count(*) FROM cx) AS linhas_validas,
       (SELECT count(*) FROM cx_raw) - (SELECT count(*) FROM cx) AS descartadas;

-- Vendedor da Umbler (primeiro nome do atendente, ou o setor) -> usuário do
-- Sendtur da mesma organização com o mesmo primeiro nome. O e-mail não serve:
-- na Umbler a Suelen usa comercial@ e o Rafael usa marketing@.
CREATE TEMP TABLE vend AS
  SELECT DISTINCT ON (pg_temp.sem_acento(cx.vendedor)) cx.vendedor, u.id AS user_id, u.name
  FROM cx
  JOIN user_organizations uo ON uo.organization_id = cx.org_id
  JOIN users u ON u.id = uo.user_id
  WHERE pg_temp.sem_acento(split_part(btrim(u.name), ' ', 1)) = pg_temp.sem_acento(cx.vendedor)
  ORDER BY pg_temp.sem_acento(cx.vendedor), u.created_at;

\echo
\echo '=== Vendedor da Umbler -> usuário do Sendtur (sem usuário = entra sem dono) ==='
SELECT cx.vendedor, v.name AS usuario_sendtur, count(*) AS conversas
FROM cx LEFT JOIN vend v ON pg_temp.sem_acento(v.vendedor) = pg_temp.sem_acento(cx.vendedor)
GROUP BY 1, 2 ORDER BY 3 DESC;

-- Contato: primeiro pelo vínculo com o canal, depois pelo telefone.
CREATE TEMP TABLE cphone AS
  SELECT c.id, regexp_replace(c.phone, '\D', '', 'g') AS digits, c.created_at
  FROM contacts c
  WHERE c.organization_id = (SELECT org_id FROM cx LIMIT 1) AND c.deleted_at IS NULL AND c.phone IS NOT NULL;
CREATE INDEX ON cphone (digits);

CREATE TEMP TABLE cx_contato AS
  SELECT DISTINCT ON (cx.umbler_chat_id) cx.umbler_chat_id, x.contact_id, x.external_id
  FROM cx
  CROSS JOIN LATERAL (
    SELECT cc.contact_id, cc.external_id, 0 AS prio, cc.created_at
    FROM contact_channels cc
    JOIN contacts c ON c.id = cc.contact_id AND c.deleted_at IS NULL
    WHERE cc.channel_id = cx.channel_id AND cc.external_id IN (cx.d, cx.alt)
    UNION ALL
    SELECT cp.id, NULL, 1, cp.created_at FROM cphone cp WHERE cp.digits IN (cx.d, cx.alt)
  ) x
  ORDER BY cx.umbler_chat_id, x.prio, x.created_at;

CREATE TEMP TABLE contato_novo AS
  SELECT cx.umbler_chat_id, gen_random_uuid()::text AS contact_id
  FROM cx WHERE NOT EXISTS (SELECT 1 FROM cx_contato k WHERE k.umbler_chat_id = cx.umbler_chat_id);

-- Situação de cada linha.
CREATE TEMP TABLE plano AS
  SELECT cx.*,
         coalesce(k.contact_id, n.contact_id) AS contact_id,
         k.external_id,
         n.contact_id IS NOT NULL AS contato_criado,
         v.user_id,
         (SELECT c.id FROM conversations c
           WHERE c.metadata ->> 'umbler_chat_id' = cx.umbler_chat_id AND c.deleted_at IS NULL
           LIMIT 1) AS ja_importada,
         (SELECT c.id FROM conversations c
           WHERE c.contact_id = coalesce(k.contact_id, n.contact_id)
             AND c.deleted_at IS NULL AND c.status <> 'CLOSED'
           ORDER BY c.last_message_at DESC NULLS LAST LIMIT 1) AS aberta_id
  FROM cx
  LEFT JOIN cx_contato k ON k.umbler_chat_id = cx.umbler_chat_id
  LEFT JOIN contato_novo n ON n.umbler_chat_id = cx.umbler_chat_id
  LEFT JOIN vend v ON pg_temp.sem_acento(v.vendedor) = pg_temp.sem_acento(cx.vendedor);

ALTER TABLE plano ADD COLUMN acao TEXT;
UPDATE plano SET acao = CASE
  WHEN ja_importada IS NOT NULL THEN 'ja_importada'
  WHEN aberta_id IS NOT NULL THEN 'aberta_no_sendtur'
  ELSE 'criar' END;
ALTER TABLE plano ADD COLUMN conv_id TEXT;
UPDATE plano SET conv_id = CASE WHEN acao = 'criar' THEN gen_random_uuid()::text ELSE aberta_id END;

\echo
\echo '=== O QUE VAI ACONTECER ==='
\echo '    criar = conversa nova | aberta_no_sendtur = fica como está, só ganha etiquetas | ja_importada = rodada anterior'
SELECT acao, count(*) AS conversas, count(*) FILTER (WHERE contato_criado) AS contatos_novos
FROM plano GROUP BY 1 ORDER BY 2 DESC;

\echo
\echo '=== Conversas novas por vendedor e aba ==='
SELECT coalesce(p.vendedor, '(sem)') AS vendedor_umbler,
       coalesce((SELECT name FROM users WHERE id = p.user_id), '— sem dono —') AS dono_no_sendtur,
       count(*) FILTER (WHERE p.aba = 'entrada') AS caixa_de_entrada,
       count(*) FILTER (WHERE p.aba = 'esperando') AS esperando
FROM plano p WHERE p.acao = 'criar'
GROUP BY 1, 2 ORDER BY count(*) DESC;

-- 1) Contatos que faltam
INSERT INTO contacts (id, organization_id, name, phone, metadata, updated_at)
  SELECT p.contact_id, p.org_id, p.nome, p.d,
         jsonb_build_object('origem', 'umbler_caixa', 'umbler_chat_id', p.umbler_chat_id),
         now()
  FROM plano p WHERE p.contato_criado AND p.acao = 'criar';

-- 2) Vínculo contato-canal (o envio usa o external_id dele)
INSERT INTO contact_channels (id, contact_id, channel_id, external_id, profile_name)
  SELECT gen_random_uuid()::text, p.contact_id, p.channel_id, p.d, p.nome
  FROM plano p
  WHERE p.acao = 'criar' AND p.external_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM contact_channels cc
                    WHERE cc.channel_id = p.channel_id AND cc.external_id IN (p.d, p.alt))
ON CONFLICT DO NOTHING;

-- 3) Conversas
INSERT INTO conversations (
  id, organization_id, channel_id, contact_id, assigned_to_id, status, protocol, is_group,
  awaiting_human_reply, last_message_at, last_inbound_at, meta_window_expires_at,
  ai_enabled, metadata, created_at, updated_at)
SELECT p.conv_id, p.org_id, p.channel_id, p.contact_id, p.user_id,
       (CASE WHEN p.user_id IS NULL THEN 'PENDING' ELSE 'OPEN' END)::"ConversationStatus",
       to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(p.umbler_chat_id), 1, 6)),
       false,
       p.aba = 'esperando',
       p.ultima_msg, p.ultima_entrada, p.janela_meta,
       CASE WHEN p.user_id IS NULL THEN NULL ELSE false END,
       jsonb_build_object('origem', 'umbler_caixa', 'umbler_chat_id', p.umbler_chat_id,
                          'umbler_setor', p.setor, 'importada_em', now()),
       p.criada_em, now()
FROM plano p WHERE p.acao = 'criar';

INSERT INTO conversation_audit_logs (id, conversation_id, action, to_value, metadata)
  SELECT gen_random_uuid()::text, p.conv_id, 'CREATED',
         CASE WHEN p.user_id IS NULL THEN 'PENDING' ELSE 'OPEN' END,
         jsonb_build_object('trigger', 'importacao_caixa_umbler', 'umbler_chat_id', p.umbler_chat_id)
  FROM plano p WHERE p.acao = 'criar';

-- 4) Etiquetas. Nome da Umbler casado sem acento/caixa; a que não existe é criada.
CREATE TEMP TABLE etq AS
  SELECT p.conv_id, p.contact_id, p.acao, btrim(e) AS nome, 'conversa' AS onde
  FROM plano p, unnest(string_to_array(p.etiquetas_conversa, '|')) e
  WHERE p.acao IN ('criar', 'aberta_no_sendtur') AND btrim(e) <> ''
  UNION
  SELECT p.conv_id, p.contact_id, p.acao, btrim(e), 'contato'
  FROM plano p, unnest(string_to_array(p.etiquetas_contato, '|')) e
  WHERE p.acao IN ('criar', 'aberta_no_sendtur') AND btrim(e) <> ''
  UNION
  -- etiqueta do vendedor na conversa nova (igual ao syncAttendantTag)
  SELECT p.conv_id, p.contact_id, p.acao, u.name, 'conversa'
  FROM plano p JOIN users u ON u.id = p.user_id WHERE p.acao = 'criar';

-- Etiqueta com nome de vendedor não entra na conversa que já era do Sendtur nem
-- no contato: o dono é o do Sendtur e a carteira já cuida da etiqueta do contato.
DELETE FROM etq e
WHERE (e.acao = 'aberta_no_sendtur' OR e.onde = 'contato')
  AND EXISTS (SELECT 1 FROM user_organizations uo JOIN users u ON u.id = uo.user_id
              WHERE uo.organization_id = (SELECT org_id FROM cx LIMIT 1)
                AND pg_temp.sem_acento(split_part(btrim(u.name), ' ', 1)) = pg_temp.sem_acento(e.nome));

CREATE TEMP TABLE etq_criar AS
  SELECT DISTINCT ON (pg_temp.sem_acento(e.nome)) e.nome
  FROM etq e
  WHERE NOT EXISTS (SELECT 1 FROM tags t
                    WHERE t.organization_id = (SELECT org_id FROM cx LIMIT 1)
                      AND pg_temp.sem_acento(t.name) = pg_temp.sem_acento(e.nome))
  ORDER BY pg_temp.sem_acento(e.nome), e.nome;

\echo
\echo '=== Etiquetas da Umbler que não existem no Sendtur (serão criadas) ==='
SELECT nome FROM etq_criar ORDER BY 1;

INSERT INTO tags (id, organization_id, name)
  SELECT gen_random_uuid()::text, (SELECT org_id FROM cx LIMIT 1), nome FROM etq_criar;

CREATE TEMP TABLE etq_id AS
  SELECT DISTINCT ON (e.conv_id, e.contact_id, e.onde, t.id) e.*, t.id AS tag_id
  FROM etq e
  JOIN tags t ON t.organization_id = (SELECT org_id FROM cx LIMIT 1)
             AND pg_temp.sem_acento(t.name) = pg_temp.sem_acento(e.nome)
  ORDER BY e.conv_id, e.contact_id, e.onde, t.id;

INSERT INTO conversation_tags (conversation_id, tag_id)
  SELECT conv_id, tag_id FROM etq_id WHERE onde = 'conversa'
ON CONFLICT DO NOTHING;

INSERT INTO contact_tags (contact_id, tag_id)
  SELECT contact_id, tag_id FROM etq_id WHERE onde = 'contato'
ON CONFLICT DO NOTHING;

\echo
\echo '=== RESULTADO ==='
SELECT (SELECT count(*) FROM plano WHERE acao = 'criar') AS conversas_criadas,
       (SELECT count(*) FROM plano WHERE acao = 'criar' AND contato_criado) AS contatos_criados,
       (SELECT count(*) FROM etq_criar) AS etiquetas_criadas,
       (SELECT count(*) FROM etq_id WHERE onde = 'conversa') AS etiquetas_em_conversas,
       (SELECT count(*) FROM etq_id WHERE onde = 'contato') AS etiquetas_em_contatos;

\if :aplicar
  COMMIT;
  \echo '>>> GRAVADO.'
\else
  ROLLBACK;
  \echo '>>> PRÉVIA: nada foi gravado. Para gravar, rode de novo com --aplicar.'
\endif
