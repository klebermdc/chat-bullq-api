-- Câmbio do dólar nas operadoras (JT, SC), lido a cada 5h.

-- CreateTable
CREATE TABLE "operator_exchange_rates" (
    "code" TEXT NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "source_updated_label" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),

    CONSTRAINT "operator_exchange_rates_pkey" PRIMARY KEY ("code")
);
