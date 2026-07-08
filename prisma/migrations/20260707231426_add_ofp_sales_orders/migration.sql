-- CreateTable
CREATE TABLE "ofp_sales_orders" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "pedido" TEXT,
    "cliente" TEXT,
    "email_cliente" TEXT,
    "telefone_cliente" TEXT,
    "vendedor" TEXT,
    "fornecedor" TEXT,
    "produto" TEXT,
    "status" TEXT,
    "venda" DECIMAL(14,2),
    "comissao" DECIMAL(14,2),
    "comissao_total" DECIMAL(14,2),
    "porcentagem_vendedor" DECIMAL(9,2),
    "comissao_vendedor" DECIMAL(14,2),
    "comissao_guia" DECIMAL(14,2),
    "enviado" BOOLEAN,
    "guia" TEXT,
    "data" TIMESTAMP(3),
    "data_raw" TEXT,
    "created_at_ext" TIMESTAMP(3),
    "updated_at_ext" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofp_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofp_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_sync_at" TIMESTAMP(3),
    "last_count" INTEGER,
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ofp_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ofp_sales_orders_external_id_key" ON "ofp_sales_orders"("external_id");

-- CreateIndex
CREATE INDEX "ofp_sales_orders_vendedor_idx" ON "ofp_sales_orders"("vendedor");

-- CreateIndex
CREATE INDEX "ofp_sales_orders_data_idx" ON "ofp_sales_orders"("data");

-- CreateIndex
CREATE INDEX "ofp_sales_orders_status_idx" ON "ofp_sales_orders"("status");

