-- Política de cancelamento no Aceite de Entrega.
--
-- `organizations.cancellation_policy` é a configuração viva, editável pelo dono.
-- `order_acceptances.policy_text` é o SNAPSHOT: cada aceite copia o texto na
-- criação. Sem a cópia, editar a configuração em novembro reescreveria
-- retroativamente um documento assinado em agosto — o comprovante deixaria de
-- provar o que aquela pessoa de fato aceitou. Mesmo motivo de `term_text` e
-- `items`, que já são copiados.
--
-- Ambas nuláveis e sem backfill: aceites já assinados ficam com
-- `policy_text` NULL e não exibem o bloco. Está certo — ninguém assinou
-- essa política.
ALTER TABLE "organizations" ADD COLUMN "cancellation_policy" TEXT;
ALTER TABLE "order_acceptances" ADD COLUMN "policy_text" TEXT;
