-- Espelho de caixa de e-mail (só leitura, via IMAP). Ver docs/plans/email-reservas.md.
-- A senha da caixa NUNCA fica no banco: password_env guarda só o nome da variável de ambiente.

-- CreateEnum
CREATE TYPE "MailboxContactRole" AS ENUM ('FROM', 'REPLY_TO', 'TO', 'CC');

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "imap_host" TEXT NOT NULL,
    "imap_port" INTEGER NOT NULL DEFAULT 993,
    "imap_secure" BOOLEAN NOT NULL DEFAULT true,
    "imap_user" TEXT NOT NULL,
    "password_env" TEXT NOT NULL,
    "folder" TEXT,
    "ignored_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uid_validity" BIGINT,
    "last_uid" BIGINT NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "uid" BIGINT NOT NULL,
    "message_id" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "subject" TEXT,
    "from_addr" TEXT,
    "from_name" TEXT,
    "to_addrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc_addrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sent_at" TIMESTAMP(3),
    "snippet" TEXT,
    "text_body" TEXT,
    "html_body" TEXT,
    "has_attachments" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_attachments" (
    "id" TEXT NOT NULL,
    "mailbox_message_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "filename" TEXT,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT,

    CONSTRAINT "mailbox_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_message_contacts" (
    "id" TEXT NOT NULL,
    "mailbox_message_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "role" "MailboxContactRole" NOT NULL,

    CONSTRAINT "mailbox_message_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_organization_id_address_key" ON "mailboxes"("organization_id", "address");

-- CreateIndex
CREATE INDEX "mailbox_messages_mailbox_id_sent_at_idx" ON "mailbox_messages"("mailbox_id", "sent_at");

-- CreateIndex
CREATE INDEX "mailbox_messages_organization_id_sent_at_idx" ON "mailbox_messages"("organization_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_messages_mailbox_id_message_id_key" ON "mailbox_messages"("mailbox_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_attachments_mailbox_message_id_position_key" ON "mailbox_attachments"("mailbox_message_id", "position");

-- CreateIndex
CREATE INDEX "mailbox_message_contacts_contact_id_idx" ON "mailbox_message_contacts"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_message_contacts_mailbox_message_id_contact_id_role_key" ON "mailbox_message_contacts"("mailbox_message_id", "contact_id", "role");

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_messages" ADD CONSTRAINT "mailbox_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_attachments" ADD CONSTRAINT "mailbox_attachments_mailbox_message_id_fkey" FOREIGN KEY ("mailbox_message_id") REFERENCES "mailbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_message_contacts" ADD CONSTRAINT "mailbox_message_contacts_mailbox_message_id_fkey" FOREIGN KEY ("mailbox_message_id") REFERENCES "mailbox_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_message_contacts" ADD CONSTRAINT "mailbox_message_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Índice de expressão para ligar e-mail ↔ contato sem depender de como o
-- e-mail foi digitado (maiúsculas/espaços). A expressão precisa ser idêntica
-- à de contact-linker.ts, senão o planner não usa o índice.
CREATE INDEX IF NOT EXISTS "contacts_org_email_lower_idx"
  ON "contacts" ("organization_id", LOWER(TRIM("email")))
  WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;
