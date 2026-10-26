-- Histórico importado da Umbler (conversas de 2025–2026), somente leitura.
--
-- Fica fora de conversations/messages de propósito: são ~2,4 milhões de
-- mensagens e não devem entrar em painel, métricas, abas, janela de 24h nem
-- no contexto da IA. O chat lê pelo TELEFONE do cliente (todas as formas, com
-- e sem 55 e 9º dígito), então aparece em qualquer contato com o mesmo número.
--
-- Os dados entram por scripts/historico-umbler (COPY fora da migration).
-- O telefone fica só em dígitos, como a Umbler entrega (ex.: 5554999442103).

CREATE TABLE IF NOT EXISTS "umbler_historico_conversas" (
  "id"              TEXT PRIMARY KEY,           -- id do chat na Umbler (contato + canal)
  "organization_id" TEXT NOT NULL,
  "telefone"        TEXT NOT NULL,
  "contato_nome"    TEXT,
  "canal_nome"      TEXT,
  "setor_nome"      TEXT,
  "etiquetas"       TEXT[] NOT NULL DEFAULT '{}',
  "atendentes"      TEXT[] NOT NULL DEFAULT '{}',
  "criada_em"       TIMESTAMPTZ,
  "ultima_msg_em"   TIMESTAMPTZ,
  "importado_em"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "umbler_historico_conversas_org_telefone_idx"
  ON "umbler_historico_conversas" ("organization_id", "telefone");

CREATE TABLE IF NOT EXISTS "umbler_historico_mensagens" (
  "id"           TEXT PRIMARY KEY,              -- id da mensagem na Umbler
  "conversa_id"  TEXT NOT NULL REFERENCES "umbler_historico_conversas" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "enviada_em"   TIMESTAMPTZ NOT NULL,
  "origem"       TEXT,                          -- Contact (cliente) | Member (atendente) | Bot
  "tipo"         TEXT,                          -- Text, Audio, Image, File...
  "conteudo"     TEXT,
  "autor"        TEXT,
  "arquivo_url"  TEXT,
  "arquivo_nome" TEXT,
  "arquivo_tipo" TEXT,
  "privada"      BOOLEAN NOT NULL DEFAULT false
);

-- Página "da mais recente para trás" dentro das conversas de um telefone.
CREATE INDEX IF NOT EXISTS "umbler_historico_mensagens_conversa_tempo_idx"
  ON "umbler_historico_mensagens" ("conversa_id", "enviada_em" DESC, "id" DESC);
