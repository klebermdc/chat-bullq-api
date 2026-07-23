# Biblioteca de Arquivos compartilhada — Design

**Data:** 2026-07-12
**Status:** Aprovado (aguardando revisão final do spec)

## Problema

Hoje, para enviar uma imagem/áudio/arquivo a um cliente, o atendente anexa do próprio
dispositivo toda vez. Material que a equipe usa repetidamente (fotos de parques, tabelas de
ingressos, áudios de boas-vindas, PDFs) fica espalhado nas máquinas individuais. Queremos uma
**biblioteca de mídia por organização**: qualquer atendente sobe um arquivo uma vez e todos os
outros atendentes da mesma org podem reusá-lo no envio ao cliente.

## Requisitos

- Biblioteca **por organização** (multi-tenant), organizada em **pastas livres** que a equipe cria.
- Aceita **qualquer tipo compatível com WhatsApp**: imagem, áudio, vídeo, documento (PDF, etc.).
- O **clip de anexar** do compositor passa a perguntar a origem: **"Do meu dispositivo"** (envio
  pontual, não salva) vs **"Biblioteca de arquivos"** (navega e envia da biblioteca).
- Escolher um arquivo da biblioteca **envia direto** para a conversa aberta.
- **Permissões:** qualquer atendente (AGENT) cria pasta e sobe arquivo; **excluir** só quem subiu
  o arquivo (`uploadedById`) ou ADMIN/OWNER.
- Áudio é **guardado como veio** (sem transcodificação no upload); a reprodução no chat já tem
  rendição sob demanda no serviço de storage.

## Não-objetivos (fora desta fatia)

- Página dedicada de gerenciamento no menu lateral (a biblioteca vive no modal do compositor).
- Tags/etiquetas, mover arquivo entre pastas, renomear em massa.
- Transcodificação especial de áudio no upload.
- Compartilhamento cross-organização ou biblioteca privada por atendente.

## Arquitetura

Enviar da biblioteca **não muda o pipeline de envio**: reusa o `POST /api/v1/messages` existente
passando `content.mediaUrl` já hospedada (mesma URL pública `/api/v1/uploads/...` que os adapters
de WhatsApp já consomem). Storage reusa o `StorageService` (MinIO/S3) e o padrão de chave dos
uploads atuais.

### Backend (`chat-bullq-api`)

**Novos modelos Prisma** (org-scoped, `onDelete: Cascade`, soft-delete espelhando `QuickReply`):

```prisma
model MediaFolder {
  id             String    @id @default(cuid())
  organizationId String    @map("organization_id")
  name           String
  createdById    String?   @map("created_by_id")
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  assets         MediaAsset[]
  @@map("media_folders")
}

model MediaAsset {
  id             String    @id @default(cuid())
  organizationId String    @map("organization_id")
  folderId       String?   @map("folder_id")
  uploadedById   String?   @map("uploaded_by_id")
  url            String
  storageKey     String    @map("storage_key")
  mimeType       String    @map("mime_type")
  size           Int
  filename       String
  title          String?
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  folder         MediaFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)
  @@index([organizationId, folderId])
  @@map("media_assets")
}
```

Guardamos `storageKey` além de `url` para permitir exclusão real do objeto no MinIO (os uploads
atuais só guardam a URL).

**Novo módulo `src/modules/media-library/`** (controller + service + repository + dto + specs),
espelhando `src/modules/quick-replies/`. Guardas: `JwtAuthGuard, OrgGuard, RolesGuard`. Contexto
via `@CurrentOrg('id')` e `@CurrentUser('id')`. Repository **sempre** filtra
`{ organizationId, deletedAt: null }`.

Rotas (prefixo `/api/v1/media-library`):

| Método | Rota | Papel | Descrição |
|---|---|---|---|
| GET | `/folders` | AGENT+ | Lista pastas da org |
| POST | `/folders` | AGENT+ | Cria pasta (`{ name }`) |
| DELETE | `/folders/:id` | dono da pasta ou ADMIN/OWNER | Soft-delete da pasta (assets ficam sem pasta) |
| GET | `/assets?folderId=` | AGENT+ | Lista assets da org (opcionalmente por pasta) |
| POST | `/assets` | AGENT+ | Multipart `file` + `folderId?` + `title?`; sobe ao MinIO e cria `MediaAsset` |
| DELETE | `/assets/:id` | `uploadedById` ou ADMIN/OWNER | Apaga objeto no MinIO + soft-delete |

Upload (`POST /assets`): `FileInterceptor('file')` (memory storage, como os uploads atuais).
Valida o mime contra um allowlist combinado (mídia + áudio + documento). Salva via
`StorageService.put` com prefixo de chave `library/<YYYY-MM-DD>/<32hex><ext>`, sem transcodificar.
Retorna o `MediaAsset` com `url` pública.

A checagem de permissão de exclusão compara `asset.uploadedById === currentUserId` **ou**
`request.organization.userRole ∈ {OWNER, ADMIN}`.

### Frontend (`chat-bullq-web`)

**Chooser de origem** em `src/features/inbox/components/chat-input.tsx`: o botão do clipe deixa de
chamar `fileInputRef.current?.click()` direto e passa a abrir um `Dropdown` (Headless UI, já usado
em `src/components/ui/dropdown.tsx`) com:
- **Do meu dispositivo** → mantém o `<input type="file">` e `onSendFile` atuais (envio pontual).
- **Biblioteca de arquivos** → abre o modal da biblioteca (novo estado `libraryOpen`, mesmo padrão
  de `proposalOpen`/`scheduleOpen`).

**Modal da Biblioteca** (`src/features/media-library/components/media-library-dialog.tsx`),
modelado em `src/features/templates/components/template-picker-dialog.tsx` (modal manual: overlay
fixo + painel `max-w-lg max-h-[90vh]`, ESC + scroll-lock):
- Navegação de pastas (topo ou coluna) + grid de miniaturas. Imagens reusam o estilo de
  `media-bubbles.tsx`; áudio/vídeo/doc mostram ícone + nome.
- Busca por nome de arquivo.
- Botão **"+ Enviar arquivo pra biblioteca"** (upload → aparece no grid).
- Botão **"+ Nova pasta"**.
- Ícone de excluir por item (visível conforme permissão).
- Clicar num arquivo → **envia direto** pra conversa: infere `IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT` do
  `mimeType` e chama o método correto de `inbox.service.ts` (reusa `sendMessage` com
  `content.mediaUrl` do asset, sem re-upload), depois fecha o modal.

**Serviço** `src/features/media-library/services/media-library.service.ts` no padrão axios
existente; TanStack Query para cache de pastas/assets, invalidado ao subir/excluir.

## Fluxo de dados (enviar da biblioteca)

1. Atendente clica no clipe → **Biblioteca de arquivos** → modal carrega pastas/assets via
   `GET /media-library/...`.
2. Clica num asset → front infere `type` do mime → `POST /api/v1/messages`
   `{ conversationId, type, content: { mediaUrl: asset.url, mimeType, fileName } }`.
3. Pipeline de envio existente enfileira `send-outbound`; adapter (Wasender/Zappfy) baixa a mídia
   pela URL pública. **Sem mudanças no pipeline.**

## Tratamento de erros

- Upload com mime não permitido → `BadRequestException` com mensagem clara na tela.
- Upload acima do limite de tamanho → `PayloadTooLargeException` / validação de tamanho no service.
- Excluir sem permissão → `ForbiddenException`.
- Falha de storage no MinIO → erro 5xx propagado; toast de erro no front.
- Excluir asset já removido → idempotente (soft-delete só marca `deletedAt`).

## Testes

- **Backend (TDD):** repository filtra por org + `deletedAt`; permissão de exclusão (dono vs
  não-dono vs admin); upload valida mime e grava `storageKey`; delete chama `StorageService`
  e marca soft-delete; isolamento cross-tenant (org A não vê assets da org B).
- **Frontend:** chooser abre as duas origens; modal lista/filtra; clicar envia com `type` correto
  inferido do mime; upload adiciona ao grid.

## Entrega

Uma fatia deployável, **1 migração** Prisma. API roda migrate no boot. Sem novas env vars
(reusa MINIO_* e APP_URL já configurados). Deploy via PR no fork (base = branch viva de deploy),
seguindo o padrão do projeto.
