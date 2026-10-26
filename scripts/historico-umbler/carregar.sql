-- Carga do histórico da Umbler. Chamado por carregar.sh.
--
-- Variáveis psql: org (id da organização no Sendtur), conv_csv e msg_csv
-- (caminhos dentro do container) e aplicar (true grava; false mostra o
-- relatório e desfaz tudo no ROLLBACK).
--
-- Idempotente: rodar de novo com um arquivo mais novo só acrescenta mensagens
-- e atualiza etiquetas/atendentes das conversas. Não toca em contacts,
-- conversations nem messages, não manda mensagem nem dispara automação.

\set ON_ERROR_STOP on
\pset footer off
BEGIN;

SELECT count(*) = 1 AS org_ok FROM organizations WHERE id = :'org' \gset
\if :org_ok
\else
  \echo 'ERRO: organização não encontrada. Confira o id em: SELECT id, name FROM organizations;'
  ROLLBACK;
  \quit
\endif

CREATE TEMP TABLE conv_raw (
  id TEXT, telefone TEXT, contato_nome TEXT, canal_nome TEXT, setor_nome TEXT,
  etiquetas TEXT, atendentes TEXT, criada_em TEXT, ultima_msg_em TEXT
);
CREATE TEMP TABLE msg_raw (
  id TEXT, conversa_id TEXT, enviada_em TEXT, origem TEXT, tipo TEXT, conteudo TEXT,
  autor TEXT, arquivo_url TEXT, arquivo_nome TEXT, arquivo_tipo TEXT, privada TEXT
);
SELECT format('COPY conv_raw FROM %L WITH (FORMAT csv, HEADER true, ENCODING %L)', :'conv_csv', 'UTF8') \gexec
SELECT format('COPY msg_raw FROM %L WITH (FORMAT csv, HEADER true, ENCODING %L)', :'msg_csv', 'UTF8') \gexec

-- Mesmas formas de telefone do phone-identity.ts (com/sem 55 e 9º dígito).
CREATE FUNCTION pg_temp.telefone_variantes(p TEXT) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  d TEXT := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  n TEXT;
  area TEXT;
  loc TEXT;
  twin TEXT;
  out TEXT[];
BEGIN
  IF length(d) < 10 THEN RETURN '{}'; END IF;
  n := CASE WHEN d LIKE '55%' AND length(d) - 2 BETWEEN 10 AND 11 THEN substr(d, 3) ELSE d END;
  out := ARRAY[d, n];
  IF length(n) BETWEEN 10 AND 11 THEN
    area := substr(n, 1, 2);
    loc := substr(n, 3);
    IF length(loc) = 9 AND loc LIKE '9%' THEN twin := area || substr(loc, 2);
    ELSIF length(loc) = 8 AND substr(loc, 1, 1) IN ('6', '7', '8', '9') THEN twin := area || '9' || loc;
    END IF;
    out := out || ARRAY['55' || n];
    IF twin IS NOT NULL THEN out := out || ARRAY[twin, '55' || twin]; END IF;
  END IF;
  RETURN ARRAY(SELECT DISTINCT unnest(out));
END $$;

\echo
\echo '=== ARQUIVOS ==='
SELECT (SELECT count(*) FROM conv_raw) AS conversas_no_arquivo,
       (SELECT count(*) FROM msg_raw) AS mensagens_no_arquivo,
       (SELECT count(*) FROM msg_raw m WHERE NOT EXISTS (SELECT 1 FROM conv_raw c WHERE c.id = m.conversa_id))
         AS mensagens_sem_conversa;

-- Quantos clientes da Umbler já têm contato no Sendtur com o mesmo telefone.
CREATE TEMP TABLE casamento AS
  WITH tel AS (SELECT DISTINCT telefone FROM conv_raw),
       ct AS (
         SELECT id, regexp_replace(phone, '\D', '', 'g') AS d
           FROM contacts
          WHERE organization_id = :'org' AND deleted_at IS NULL AND phone IS NOT NULL
       )
  SELECT t.telefone, count(DISTINCT ct.id) AS contatos
    FROM tel t
    LEFT JOIN ct ON ct.d = ANY(pg_temp.telefone_variantes(t.telefone))
   GROUP BY t.telefone;

\echo
\echo '=== CASAMENTO COM CONTATOS DO SENDTUR (por telefone) ==='
SELECT count(*) AS telefones_umbler,
       count(*) FILTER (WHERE contatos = 1) AS com_1_contato,
       count(*) FILTER (WHERE contatos > 1) AS com_2_ou_mais_contatos,
       count(*) FILTER (WHERE contatos = 0) AS sem_contato_ainda
  FROM casamento;
\echo '(2 ou mais = a mesma pessoa em mais de um canal do Sendtur: o histórico aparece em todos.)'
\echo '(sem contato ainda = aparece quando esse cliente chegar, pelo mesmo telefone.)'

\echo
\echo '=== CONVERSAS QUE JÁ ESTÃO EM OUTRA ORGANIZAÇÃO (ficam como estão) ==='
SELECT count(*) AS conversas_de_outra_org
  FROM conv_raw r JOIN umbler_historico_conversas u ON u.id = r.id
 WHERE u.organization_id <> :'org';

-- A prévia não escreve nada: 2,4 milhões de linhas inseridas e desfeitas só
-- gerariam WAL e lixo na produção. O relatório acima já é o que importa.
\if :aplicar
-- Datas cortadas no milissegundo: o chat pagina por (enviada_em, id) e o
-- cursor volta do navegador como Date do JS, que só tem milissegundos.
INSERT INTO umbler_historico_conversas AS u
  (id, organization_id, telefone, contato_nome, canal_nome, setor_nome,
   etiquetas, atendentes, criada_em, ultima_msg_em)
SELECT id, :'org', telefone, NULLIF(contato_nome, ''), NULLIF(canal_nome, ''), NULLIF(setor_nome, ''),
       coalesce(NULLIF(etiquetas, '')::text[], '{}'), coalesce(NULLIF(atendentes, '')::text[], '{}'),
       date_trunc('milliseconds', NULLIF(criada_em, '')::timestamptz),
       date_trunc('milliseconds', NULLIF(ultima_msg_em, '')::timestamptz)
  FROM conv_raw
ON CONFLICT (id) DO UPDATE
   SET etiquetas = EXCLUDED.etiquetas,
       atendentes = EXCLUDED.atendentes,
       setor_nome = EXCLUDED.setor_nome,
       ultima_msg_em = EXCLUDED.ultima_msg_em,
       importado_em = now()
 WHERE u.organization_id = EXCLUDED.organization_id;

INSERT INTO umbler_historico_mensagens
  (id, conversa_id, enviada_em, origem, tipo, conteudo, autor,
   arquivo_url, arquivo_nome, arquivo_tipo, privada)
SELECT m.id, m.conversa_id, date_trunc('milliseconds', m.enviada_em::timestamptz),
       NULLIF(m.origem, ''), NULLIF(m.tipo, ''),
       NULLIF(m.conteudo, ''), NULLIF(m.autor, ''), NULLIF(m.arquivo_url, ''),
       NULLIF(m.arquivo_nome, ''), NULLIF(m.arquivo_tipo, ''), m.privada = 't'
  FROM msg_raw m
  JOIN conv_raw c ON c.id = m.conversa_id
  JOIN umbler_historico_conversas u ON u.id = m.conversa_id AND u.organization_id = :'org'
ON CONFLICT (id) DO NOTHING;
\endif

\echo
\echo '=== RESULTADO ==='
SELECT (SELECT count(*) FROM umbler_historico_conversas WHERE organization_id = :'org') AS conversas_total,
       (SELECT count(*) FROM umbler_historico_mensagens m
          JOIN umbler_historico_conversas c ON c.id = m.conversa_id
         WHERE c.organization_id = :'org') AS mensagens_total,
       (SELECT min(enviada_em) FROM umbler_historico_mensagens) AS mais_antiga,
       (SELECT max(enviada_em) FROM umbler_historico_mensagens) AS mais_recente;

\if :aplicar
  COMMIT;
  ANALYZE umbler_historico_conversas;
  ANALYZE umbler_historico_mensagens;
  \echo '>>> GRAVADO.'
\else
  ROLLBACK;
  \echo '>>> PRÉVIA: nada foi gravado. Para gravar, rode de novo com --aplicar.'
\endif
