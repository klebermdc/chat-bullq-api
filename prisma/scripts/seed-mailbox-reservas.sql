-- Cadastra a caixa reservas@orlandofastpass.com.br no espelho de e-mail.
-- Idempotente: rodar de novo só reativa a caixa e confirma host/porta/usuário,
-- sem mexer no cursor da sincronização (uid_validity / last_uid).
--
-- A senha NÃO vai aqui: password_env é só o NOME da variável de ambiente.
-- Antes, grave MAILBOX_RESERVAS_PASSWORD (senha de app do Google) no .env da
-- VPS e no environment: do serviço da API no docker-compose.
--
-- folder = NULL → automático: a pasta marcada \All ("[Gmail]/All Mail" ou
-- "[Gmail]/Todos os e-mails", conforme o idioma da conta); sem ela, INBOX.
--
-- USO (org_id = id da organização da OFP):
--   psql -v org_id="'<id da org>'" -f prisma/scripts/seed-mailbox-reservas.sql
-- ou, no container:
--   docker exec -i chat-ofp-postgres-1 psql -U <usuario> -d <banco> \
--     -v org_id="'<id da org>'" < prisma/scripts/seed-mailbox-reservas.sql

INSERT INTO mailboxes (
  id, organization_id, address, imap_host, imap_port, imap_secure, imap_user,
  password_env, folder, enabled, updated_at
)
SELECT
  gen_random_uuid()::text, o.id, 'reservas@orlandofastpass.com.br', 'imap.gmail.com', 993, true,
  'reservas@orlandofastpass.com.br', 'MAILBOX_RESERVAS_PASSWORD', NULL, true, now()
FROM organizations o
WHERE o.id = :org_id
ON CONFLICT (organization_id, address) DO UPDATE SET
  imap_host = EXCLUDED.imap_host,
  imap_port = EXCLUDED.imap_port,
  imap_secure = EXCLUDED.imap_secure,
  imap_user = EXCLUDED.imap_user,
  password_env = EXCLUDED.password_env,
  enabled = true,
  updated_at = now();

SELECT id, organization_id, address, folder, enabled, last_uid, last_error
FROM mailboxes
WHERE address = 'reservas@orlandofastpass.com.br';
