-- Expiração da janela informada pela própria Meta no webhook de status
-- (`statuses[].conversation.expiration_timestamp`). Fonte autoritativa do
-- free entry point de 72h dos leads Click-to-WhatsApp: sob pricing PMP a Meta
-- deixou de anexar `referral` na mensagem de entrada, então `contacts
-- .ctwa_clid_at` fica NULL em parte dos leads de anúncio e a janela caía para
-- 24h (selo errado, gate recusando texto livre e cadência morrendo).
ALTER TABLE "conversations" ADD COLUMN "meta_window_expires_at" TIMESTAMP(3);
