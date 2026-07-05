# Design: Menu de Provedores de IA (API Keys gerenciáveis)

**Data:** 2026-07-05
**Status:** Aprovado (design) — aguardando plano de implementação

## Problema

Hoje as chaves de provedores de IA vivem em variáveis de ambiente e só mudam
editando o `.env` do servidor e reiniciando a API:

- `GROQ_API_KEY` → transcrição de áudio (`messaging/messages/transcription.service.ts`)
- `OPENAI_API_KEY` → embeddings/RAG (`ai-agents/rag/embeddings.service.ts`)
- `SAKANA_API_KEY` → LLM dos agentes (`ai-agents/llm/llm.service.ts`)

Queremos um **menu nas configurações** onde um admin da organização cadastra
chaves e seleciona **o que cada chave faz** (transcrição / embeddings / LLM),
com as chaves salvas (criptografadas) no banco, por organização.

## Objetivo / Não-objetivo

**Objetivo**
- Tela em `/settings/ai-providers` para CRUD de chaves de provedores de IA.
- Cada chave: apelido, provedor, segredo, e uma ou mais **funções** que ela serve.
- Chaves criptografadas em repouso; segredo nunca retorna ao browser.
- Serviços de IA resolvem a chave a partir do banco (por org), com **fallback
  para o `.env`** enquanto a migração não termina.
- Apenas OWNER/ADMIN gerenciam.

**Não-objetivo**
- Não é a aba `/settings/api-keys` existente (essa é de chaves *do nosso app*
  para acesso externo via MCP/Zapier — conceito diferente, permanece intacta).
- Sem rotação automática, sem billing/uso por chave, sem multi-região. YAGNI.

## Abordagem escolhida

**Registro de chaves + seleção de uso** (Abordagem B). O usuário cadastra
chaves numa lista e marca, por chave, quais funções ela atende. Um resolver
central mapeia `(organização, função) → chave`.

**Regra de dono único:** cada função tem no máximo **uma** chave dona por
organização. Ao atribuir uma função a uma chave, ela é removida de qualquer
outra chave da mesma org (comportamento de rádio-button). Isso torna a
resolução determinística e a UI clara ("Transcrição é atendida por: <chave>").

## Modelo de dados

Nova tabela `ai_provider_keys` e dois enums no `prisma/schema.prisma`:

```prisma
enum AiProvider {
  GROQ
  OPENAI
  SAKANA
}

enum AiCapability {
  TRANSCRIPTION
  EMBEDDINGS
  AGENT_LLM
}

model AiProviderKey {
  id             String         @id @default(cuid())
  organizationId String         @map("organization_id")
  name           String
  provider       AiProvider
  encryptedKey   String         @map("encrypted_key") // AES-256-GCM: iv:tag:ciphertext (base64)
  keyPreview     String         @map("key_preview")   // ex.: "gsk_…70tIFI"
  capabilities   AiCapability[]
  baseUrl        String?        @map("base_url")       // opcional (Sakana/custom)
  model          String?                                // opcional (override de modelo)
  createdAt      DateTime       @default(now())        @map("created_at")
  updatedAt      DateTime       @updatedAt             @map("updated_at")

  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId], name: "idx_ai_provider_key_org")
  @@map("ai_provider_keys")
}
```

> `capabilities` como array de enum (suportado no Postgres via Prisma). A regra
> de dono único é garantida na camada de serviço, não por constraint de banco.

## Backend

Novo módulo `modules/ai-provider-keys/`:

- **Controller** `ai-provider-keys.controller.ts` — todos com `@Roles(OWNER, ADMIN)`
  e `@CurrentOrg('id')`:
  - `GET    /ai-provider-keys` — lista (mascarada, com funções)
  - `POST   /ai-provider-keys` — cria `{ name, provider, key, capabilities[], baseUrl?, model? }`
  - `PATCH  /ai-provider-keys/:id` — atualiza (nome, funções, opcionalmente troca a chave)
  - `DELETE /ai-provider-keys/:id`
  - `POST   /ai-provider-keys/:id/test` — (opcional) ping no provedor pra validar a chave
- **Service** `ai-provider-keys.service.ts` — criptografia, regra de dono único,
  geração do `keyPreview`, nunca expõe o segredo.
- **Repository** `ai-provider-keys.repository.ts` — Prisma.

### Criptografia

`CryptoService` (em `common/crypto/`) com **AES-256-GCM**:
- Chave-mestra de 32 bytes vinda de novo env `KEY_ENCRYPTION_SECRET` (hex de 64 chars).
- Formato armazenado: `base64(iv).base64(authTag).base64(ciphertext)`.
- Se `KEY_ENCRYPTION_SECRET` ausente/ inválida → erro claro ao salvar (não salva
  segredo em texto plano). Isto é um avanço sobre o padrão atual (credenciais de
  canal ficam em JSON não criptografado); não vamos migrar os canais neste escopo.

### Resolver

`ProviderKeyResolverService` (exportado):

```ts
resolve(orgId: string, capability: AiCapability):
  Promise<{ provider: AiProvider; apiKey: string; baseUrl?: string; model?: string } | null>
```

1. Busca no banco a chave da org com aquela `capability`; descriptografa.
2. Se não houver, **fallback para o `.env`** por função:
   - `TRANSCRIPTION` → `GROQ_API_KEY` (provider GROQ)
   - `EMBEDDINGS`    → `OPENAI_API_KEY` (provider OPENAI)
   - `AGENT_LLM`     → `SAKANA_API_KEY` + `SAKANA_BASE_URL` (provider SAKANA)
3. Retorna `null` só se não houver nem banco nem env → o consumidor lança o
   erro atual ("… not configured").

Cache opcional em memória (TTL curto, invalidado no save) para evitar
descriptografar a cada mensagem. Pode ficar para depois se complicar.

## Ligando os consumidores

### Transcrição (limpo)
`transcription.service.ts` já tem `organizationId`. Trocar
`config.get('GROQ_API_KEY')` por `resolver.resolve(orgId, 'TRANSCRIPTION')`.
Endpoint e modelo passam a depender do `provider` retornado:
- `GROQ`   → `https://api.groq.com/openai/v1/audio/transcriptions`, modelo `whisper-large-v3-turbo`
- `OPENAI` → `https://api.openai.com/v1/audio/transcriptions`, modelo `whisper-1`
- `model` da chave, se preenchido, sobrescreve o default.

### Embeddings (médio)
`embeddings.service.ts` lê a chave no **constructor** hoje. Mudar para resolver
por-request:
- `embed(text, orgId)` e `embedBatch(texts, orgId)` ganham `orgId`.
- Ajustar call sites: `rag/indexer.processor.ts` e `rag/retrieval.service.ts`
  passam o `orgId` do contexto (documentos/consultas são por org). Verificar na
  implementação que ambos têm o `orgId` disponível — se não tiverem, threa-lo a
  partir do job/params.

### LLM dos agentes (mais pesado)
`LlmService` é **singleton** e monta o cliente OpenAI no constructor; é usado por
runner, classifier, memória, RAG e evals. Para chave por-org:
- Introduzir `getClient(orgId)` com **cache de cliente por org** (constrói o
  `OpenAI` a partir de `resolver.resolve(orgId, 'AGENT_LLM')`), invalidado quando
  a chave da org muda.
- `complete(req)` passa a exigir `orgId` no `req` (ou parâmetro), propagado pelos
  chamadores. É a mudança de maior superfície.

## Frontend

- Nova aba em `app/(dashboard)/settings/layout.tsx`: **"Provedores IA"** →
  `/settings/ai-providers`.
- Página `app/(dashboard)/settings/ai-providers/page.tsx`:
  - Lista de chaves: apelido, badge do provedor, máscara (`gsk_…70tIFI`), chips
    das funções, ações editar/excluir.
  - Botão "Adicionar chave" → modal: apelido, provedor (select), chave (input
    secreto), funções (checkboxes: Transcrição / Embeddings / LLM), baseUrl e
    modelo opcionais.
  - Modal de edição reaproveita o form; troca de chave é opcional (deixar em
    branco mantém a atual).
  - Segue o padrão de `settings/members` e `settings/api-keys` (TanStack Query,
    `features/settings/services/ai-providers.service.ts`, cliente `@/lib/api`).
- Feedback visual quando uma função está usando **fallback do .env** vs. chave do
  banco (badge "via ambiente") para o admin saber o estado real.

## Segurança

- Chaves criptografadas em repouso (AES-256-GCM, chave-mestra em env).
- Segredo **nunca** retorna ao cliente — só `keyPreview`.
- Endpoints restritos a OWNER/ADMIN via `@Roles` + `RolesGuard`.
- Escopo por organização em todas as queries (`organizationId`).

## Migração / Config

- Migração Prisma: tabela `ai_provider_keys` + enums `AiProvider`, `AiCapability`.
- Novo env `KEY_ENCRYPTION_SECRET` em `.env`, `.env.example`,
  `.env.production.example` e passado ao container `api` no `docker-compose.yml`.
- `GROQ_API_KEY` / `OPENAI_API_KEY` / `SAKANA_*` permanecem como **fallback**.

## Testes

- `CryptoService`: roundtrip encrypt→decrypt; erro sem chave-mestra.
- `ProviderKeyResolverService`: acerto no banco; fallback pro env; regra de dono
  único (atribuir função remove das demais).
- E2E do CRUD `/ai-provider-keys` com guard de role (AGENT recebe 403).
- Transcrição: resolve GROQ do banco e cai no env quando ausente.

## Faseamento (risco)

Ordenado do mais seguro ao mais invasivo — o plano de implementação pode quebrar
em PRs se necessário:

1. **Fundação**: modelo + migração + `CryptoService` + módulo CRUD + tela.
   (Já utilizável: cadastrar/selecionar chaves; nada consome ainda além do passo 2.)
2. **Transcrição** ligada ao resolver (baixo risco, `orgId` já disponível).
3. **Embeddings** ligados (threar `orgId` em 2 call sites).
4. **LLM** ligado (cache de cliente por org + `orgId` no `complete`; maior
   superfície — candidato a PR próprio).

A UI expõe as três funções desde o passo 1; funções ainda não ligadas continuam
lendo do `.env` via fallback, então nada quebra durante a transição.
