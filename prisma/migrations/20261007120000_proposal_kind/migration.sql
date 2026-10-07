-- Proposta com print. "kind": PARKS = ingressos (tudo o que existia até aqui);
-- OTHER = outro produto lido do print (carro, hotel, transfer…), que não tem
-- parques, datas nem passageiros. "details": { title, lines } do OTHER e, nos
-- dois tipos, os prints enviados ao cliente ({ images }). Nulo = sem print.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PARKS';
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "details" JSONB;
