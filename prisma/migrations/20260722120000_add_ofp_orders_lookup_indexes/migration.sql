-- Índices de expressão para a skill `checkPurchase` (ETAPA ZERO da IA).
--
-- A consulta casa pedido↔cliente por final de telefone (últimos 8 dígitos,
-- ignorando DDI e 9º dígito) e por e-mail normalizado. Sem estes índices o
-- Postgres faz seq scan em ofp_sales_orders a CADA mensagem atendida pela IA.
--
-- As expressões abaixo precisam ser idênticas às usadas em
-- check-purchase.tool.ts, senão o planner não usa o índice.

CREATE INDEX IF NOT EXISTS "ofp_sales_orders_phone_tail_idx"
  ON "ofp_sales_orders" (
    RIGHT(REGEXP_REPLACE(COALESCE("telefone_cliente", ''), '[^0-9]', '', 'g'), 8)
  );

CREATE INDEX IF NOT EXISTS "ofp_sales_orders_email_lower_idx"
  ON "ofp_sales_orders" (
    LOWER(TRIM(COALESCE("email_cliente", '')))
  );
