-- Conversa compartilhada: vendedor incluído na conversa de outro.
CREATE TABLE IF NOT EXISTS "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "added_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversation_id_user_id_key"
    ON "conversation_participants"("conversation_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_conv_participant_user"
    ON "conversation_participants"("user_id");

ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_participants"
    ADD CONSTRAINT "conversation_participants_added_by_id_fkey"
    FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
