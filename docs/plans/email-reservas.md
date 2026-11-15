# Caixa reservas@ dentro do Sendtur (só leitura)

Data: 2026-11-15 · Pedido do Kleber · Primeiro passo para sair do Google Workspace.

## Decisões
- **Só leitura** na v1. Responder continua no Gmail.
- **Quem vê:** AGENT vê os e-mails de um contato só se alcança alguma conversa dele
  (`scopedUserWhere`: dono ou incluído). A tela da caixa inteira é só para OWNER/ADMIN.
- **Histórico:** importa os últimos 5 meses (150 dias) na primeira sincronização; era 12, reduzido em 15/11.
- **Fonte:** IMAP (imapflow) com senha de app. Funciona com o Google hoje e com Hostinger/Zoho
  depois, só trocando host/usuário/senha. Sem mexer em MX.

## Dados (Prisma)
- `Mailbox`: org, address, imapHost, imapPort, imapUser, senha (variável de ambiente
  `MAILBOX_<ID>_PASSWORD`, nunca no banco), folder (`[Gmail]/All Mail` ou `INBOX`), uidValidity,
  lastUid, lastSyncAt, lastError, enabled.
- `EmailMessage`: org, mailboxId, uid, messageId (único por mailbox), inReplyTo, subject,
  fromAddr/fromName, to[], cc[], sentAt, snippet, textBody, htmlBody (sanitizado na exibição),
  hasAttachments.
- `EmailAttachment`: messageId, filename, contentType, size, storageKey (MinIO `email/<org>/<id>/<n>`).
- `EmailMessageContact`: (emailMessageId, contactId, role FROM|TO|CC), unique.

## Ligação com o cliente
Endereços de From/To/Cc/Reply-To normalizados (minúsculas, sem espaços) → `contacts.email`
na mesma org (já tem o índice `idx_contact_org_email`). Endereços da própria caixa e do domínio
da org são ignorados. Contato que ganhar e-mail depois → religar via job de backfill (fase 2).

## Sincronização
- Job BullMQ `email-mailbox-sync` a cada 5 min, concorrência 1.
- Primeira execução: `SEARCH SINCE hoje-365d`. Depois: UIDs > lastUid. Se a uidValidity mudar,
  re-sincroniza pelo Message-ID (idempotente).
- Lotes de 50, anexos > 15 MB ignorados (só registra o nome). Erro → `lastError` + ErrorReporter.

## API
- `GET /contacts/:id/emails` (escopo do AGENT como acima), paginado.
- `GET /emails/:id` detalhe (mesmo escopo, via contatos ligados; ADMIN vê tudo).
- `GET /emails/:id/attachments/:attId` → stream do MinIO.
- `GET /mailboxes/:id/emails` (OWNER/ADMIN), com filtro "sem cliente".
- `GET /mailboxes` status da sincronização (OWNER/ADMIN).

## Web (PR separado)
- Aba **E-mails** no card do cliente: lista (assunto, de, data, 📎) → leitor com HTML sanitizado e anexos.
- Tela **Reservas** (ADM/Owner): a caixa inteira, com a etiqueta do cliente encontrado.

## Fora da v1
Responder, enviar o voucher pelo WhatsApp, ligar por nome/localizador quando o e-mail não bate,
outras caixas.

## Pré-requisito do Kleber
Senha de app do reservas@ (precisa da verificação em 2 etapas nessa conta), gravada no `.env` da
VPS como `MAILBOX_RESERVAS_PASSWORD`. Nunca colar no chat.

## Notas da implementação (PR 1, API)
- Modelos chamam `Mailbox`, `MailboxMessage`, `MailboxAttachment`, `MailboxMessageContact`
  (tabelas `mailboxes`, `mailbox_messages`…): `EmailMessage` já existe (campanhas).
- Papel `REPLY_TO` além de FROM/TO/CC. `uid`/`lastUid` são BigInt (UID IMAP vai até 2³²).
- `folder` NULL = automático (pasta `\All`, senão INBOX). `ignoredDomains` na caixa: a org não
  tem campo de domínio, então o domínio "da casa" é o do endereço da caixa + essa lista.
- `passwordEnv` só aceita `MAILBOX_<NOME>_PASSWORD` (quem edita o banco não lê outro segredo).
- Teto de 500 mensagens por rodada: a importação dos 12 meses anda em várias rodadas de 5 min.
- Índice de expressão `contacts_org_email_lower_idx` (organization_id, LOWER(TRIM(email))):
  o e-mail do contato é gravado como foi digitado.
- Permissão nova `mailbox.view` (STAFF) para a tela da caixa inteira.
