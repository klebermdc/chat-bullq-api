-- Aditiva: nenhuma coluna existente é alterada, nenhum dado é reescrito.
ALTER TABLE "order_acceptances" ADD COLUMN "vouchers" JSONB DEFAULT '[]';
ALTER TABLE "order_acceptances" ADD COLUMN "order_ref" TEXT;
