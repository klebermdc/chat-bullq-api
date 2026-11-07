-- Desfaz a importação das caixas da Umbler. Chamado por carregar.sh --desfazer.
-- Apaga só as conversas importadas em que ninguém mexeu (nenhuma mensagem no
-- Sendtur) e os contatos criados pela importação que ficaram sem conversa.
-- Etiquetas criadas ficam (podem já estar em uso).
\set ON_ERROR_STOP on
\pset footer off
BEGIN;

CREATE TEMP TABLE alvo AS
  SELECT c.id FROM conversations c
  WHERE c.metadata ->> 'origem' = 'umbler_caixa'
    AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id);

SELECT (SELECT count(*) FROM conversations WHERE metadata ->> 'origem' = 'umbler_caixa') AS importadas,
       (SELECT count(*) FROM alvo) AS sem_mensagem_serao_apagadas;

DELETE FROM conversations c USING alvo a WHERE c.id = a.id;

DELETE FROM contacts ct
WHERE ct.metadata ->> 'origem' = 'umbler_caixa'
  AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.contact_id = ct.id);

\if :aplicar
  COMMIT;
  \echo '>>> DESFEITO.'
\else
  ROLLBACK;
  \echo '>>> PRÉVIA: nada foi apagado. Para apagar, rode de novo com --desfazer --aplicar.'
\endif
