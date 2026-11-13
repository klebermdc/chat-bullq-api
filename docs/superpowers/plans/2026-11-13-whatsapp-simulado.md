# WhatsApp simulado (cliente oculto sem chip) — desenho + plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD obrigatório (teste falhando → código → teste passando). Checkbox por passo.

**Goal:** permitir visitas de cliente oculto com números falsos, 100% internos: a mensagem do "cliente" entra pelo mesmo caminho da Meta e as respostas da equipe nunca saem para a Meta.

**Base:** parte 1 no ar (`c95bb68`). Spec da parte 1: `docs/superpowers/specs/2026-11-13-cliente-oculto-parte1-design.md`.

**Worktrees:** API `~/dev/api-cliente-oculto` branch `feat/whatsapp-simulado` (de `origin/feat/conversation-tabs`); web `~/dev/ux-web-cliente-oculto` branch nova `feat/whatsapp-simulado` de `origin/feat/conversation-tabs`.

**Testes API:** neste worktree o `node_modules` é simbólico e o Jest pode carregar `.prisma/client` velho; rodar com
`npx jest -c /private/tmp/claude-501/-Users-kleber-Desktop-Mesa-agent-browser-0-2-0-2-Teste-md-Chat-OFP/281088e9-59cf-4aa2-a454-80a78b29c4e5/scratchpad/jest.tmp.js <paths>` e `npm run typecheck`. Depois de mudar o schema: `npx prisma generate` (com `DATABASE_URL` fictício se pedir).

---

## Desenho

### Pontos únicos (mapeados em 13/11)
| Fluxo | Ponto | Ação |
|---|---|---|
| Envio ao cliente (texto, mídia, template, Aline, cadência) | `src/modules/messaging/pipeline/outbound-message.processor.ts:43` (`adapterRegistry.getOutbound` → `adapter.sendMessage`) | contato simulado → `SimulatedOutboundAdapter` (nada sai) |
| Mensagem do cliente | fila de entrada, job `process-inbound` (`channel-hub/webhook-gateway.controller.ts:170`) | simulador enfileira `NormalizedInboundMessage` igual ao webhook |
| Entregue/lido | mesma fila, job `process-status` (`webhook-gateway.controller.ts:191`) | adaptador simulado enfileira `delivered` (+2 s) e `read` (+6 s) com `delay` |
| Ligação pelo WhatsApp (vendedor) | `voice/seller-calls.service.ts` (`requestPermission`, `start`) | contato simulado: permissão fica pendente, nada chama a Meta; `start` recusa |
| Ligação da Aline | `voice/outreach/outreach.service.ts` (`requestPermissions`, `callDue`) | pular contatos simulados |
| Ligação Sonax (telefone comum) | `calls/calls.service.ts:22 initiateCall` | **bloquear** (número falso pode existir de verdade) |
| Webhooks para fora (Make/n8n) | `webhooks/webhook-dispatch.service.ts` | não disparar evento de conversa/contato simulado |

### Modelo
- `MysteryShopperNumber.isSimulated Boolean @default(false) @map("is_simulated")` + `channelId String? @map("channel_id")` (canal onde o simulado "existe"; FK `Channel` onDelete SetNull).
- Número simulado: `55` + DDD `11` + `9` + 8 dígitos aleatórios, sem colisão com contato existente da org (checar `phoneVariants`). Cria `Contact` (marcado `isMysteryShopper`, `phone`, `name` = nome de perfil opcional) + `ContactChannel` (`channelId`, `externalId` = dígitos, `profileName`) + `MysteryShopperNumber` (`isSimulated: true`, `label`, `channelId`).
- "É simulado?": `SimulatedRecipients.isSimulated(channelId, contactExternalId)` = existe `ContactChannel` (channelId, externalId) cujo contato tem algum `MysteryShopperNumber` com `isSimulated = true` (removido ou não: **um número simulado nunca vai para a Meta**, mesmo removido). Consulta por índice único `uq_contact_channel_external`.

### Fluxo
1. Viewer cria "cliente simulado" (apelido, nome de perfil opcional, canal WhatsApp oficial da org).
2. Aba **Simulador**: escolhe o número, digita como cliente → `POST /mystery-shopper/simulator/:numberId/messages` → enfileira `process-inbound` com `externalMessageId = sim.in.<cuid>`, `externalContactId = contactPhone = dígitos`, `contactName = nome de perfil`, `channelType = canal.type`, `type: 'TEXT'`, `content: { text }`, `rawPayload: { simulated: true }`. O resto (contato, conversa, Aline, distribuição, SLA, visita da parte 1) acontece sozinho.
3. Respostas: o processor de saída detecta o simulado e usa o adaptador simulado → `externalId = sim.out.<cuid>`; agenda `delivered`/`read`. O vendedor vê ✓✓ azul como num cliente real.
4. A tela do Simulador lê `GET /mystery-shopper/simulator/:numberId` (mensagens da conversa mais recente do contato, do ponto de vista do cliente) a cada 3 s.

### Fora do escopo
Mídia enviada pelo cliente simulado (só texto), robô automático (parte 2), áudio.

---

## Tarefas

### Task S1 (API): schema + detector + adaptador simulado + desvio no envio
**Files:** `prisma/schema.prisma`, migração `prisma/migrations/20261113210000_mystery_shopper_simulated/` (gerar com `prisma migrate diff` a partir de `git show HEAD:prisma/schema.prisma`; parar se aparecer mudança fora das 2 colunas novas, índice e FK), `src/modules/mystery-shopper/simulated/simulated-recipients.service.ts`, `src/modules/mystery-shopper/simulated/simulated-outbound.adapter.ts`, `src/modules/messaging/pipeline/outbound-message.processor.ts`, specs.

- `SimulatedRecipients` (`@Injectable`, Prisma): `isSimulated(channelId, contactExternalId): Promise<boolean>`; `isSimulatedContact(contactId): Promise<boolean>`; `isSimulatedConversation(conversationId): Promise<boolean>`.
- `SimulatedOutboundAdapter implements OutboundChannelPort`: `channelType` igual ao do canal recebido (não registrar no `ChannelAdapterRegistry`); `sendMessage` → `{ externalId: 'sim.out.' + cuid, providerResponse: { simulated: true } }` e enfileira na **mesma fila de entrada** (mesmo nome/constante usada no `webhook-gateway.controller.ts`) dois jobs `process-status` com `{ channelId, organizationId, status: { externalMessageId, status: 'delivered'|'read', timestamp } }` e `delay` 2000/6000; `sendTypingIndicator` no-op; `getMediaUrl`/`downloadMedia` lançam `Error('Mídia indisponível em contato simulado')`; `deleteMessage` no-op.
- Processor: depois de carregar o canal, `const adapter = (await this.simulated.isSimulated(channel.id, contactExternalId)) ? this.simulatedAdapter : this.adapterRegistry.getOutbound(channel.type)`. A janela (`windowGate`) e o "digitando" continuam iguais (realismo). Registrar provider do módulo onde o processor vive (exportar de um `SimulatedModule` pequeno importado pelo módulo de mensagens; evitar import circular com o `MysteryShopperModule` — o módulo simulado depende só de Prisma e da fila).
- **Testes obrigatórios:** contato normal → adaptador do registro chamado e simulado não; contato simulado → simulado chamado e o do registro **não**; adaptador simulado devolve id `sim.out.` e enfileira 2 status com delay; `isSimulated` falso para contato marcado como cliente oculto mas **não** simulado (chip real).
- Commit: `feat: envio desviado para contato simulado do cliente oculto`.

### Task S2 (API): bloqueios (ligações e webhooks externos)
**Files:** `voice/seller-calls.service.ts`, `voice/outreach/outreach.service.ts`, `calls/calls.service.ts`, `webhooks/webhook-dispatch.service.ts`, specs.
- Vendedor: `requestPermission` em conversa simulada → responde como pedido enviado (mesmo formato do caminho real) **sem** chamar a Meta e grava a mesma nota de sistema; `check` → permissão pendente; `start` → mesma exceção que o caminho real usa quando a permissão não foi concedida.
- Aline (`outreach`): pular propostas/conversas de contato simulado em `requestPermissions` e `callDue`.
- Sonax `initiateCall`: contato simulado → `BadRequestException('Não foi possível completar a ligação.')` antes de qualquer chamada externa.
- Webhooks: ao montar o evento, se o payload se refere a conversa/contato simulado, não criar a entrega (ler o dispatch para achar `conversationId`/`contactId` no payload; se o formato não permitir, adicionar um parâmetro opcional `skipIfSimulated` nos chamadores de eventos de conversa/mensagem/contato e reportar).
- **Testes obrigatórios:** cada bloqueio com contato simulado não chama o cliente HTTP externo; contato normal segue chamando.
- Commit: `feat: ligações e webhooks externos não alcançam contato simulado`.

### Task S3 (API): criar número simulado e rotas do simulador
**Files:** `mystery-shopper/simulated/simulator.service.ts`, `mystery-shopper.repository.ts` (métodos novos), `mystery-shopper.controller.ts`, `dto/add-simulated-number.dto.ts`, `dto/simulator-message.dto.ts`, `mystery-shopper.module.ts`, specs.
- `GET /mystery-shopper/channels` → canais WhatsApp oficiais ativos da org `{ id, name }`.
- `POST /mystery-shopper/numbers/simulated` `{ label (≤60), profileName? (≤60), channelId }` → cria como no Desenho (transação; até 5 tentativas de número sem colisão). Resposta igual a um item de `GET /numbers` + `isSimulated: true`.
- `GET /mystery-shopper/numbers` passa a devolver `isSimulated` e `channelId`.
- `POST /mystery-shopper/simulator/:numberId/messages` `{ text (1..2000) }` → só número simulado ativo da org; enfileira `process-inbound` como no Desenho; responde `{ queued: true, externalMessageId }`.
- `GET /mystery-shopper/simulator/:numberId` → `{ number: {id,label,phone,profileName}, conversationId|null, messages: [{ id, from: 'CLIENTE'|'EMPRESA', text, createdAt, status }] }` da conversa mais recente do contato naquele canal (últimas 200, ordem cronológica; `EMPRESA` = qualquer OUTBOUND; sem nomes de vendedor? **mostrar** o `senderName` como o WhatsApp mostraria a assinatura já embutida no texto — usar só o texto).
- Todas as rotas: `assertViewer` (404 para os demais).
- **Testes obrigatórios:** número gerado com 13 dígitos começando `55119`; colisão gera outro; envio recusado para número não simulado (400) ou de outra org (404); job enfileirado com o formato do Desenho; viewer-only.
- Commit: `feat: números simulados e rotas do simulador`.

### Task W1 (web): Números + aba Simulador
**Files:** `src/features/mystery-shopper/api.ts` (tipos/chamadas novas), `components/numbers-tab.tsx` (form "Novo cliente simulado": apelido, nome de perfil, canal; coluna "Tipo" Simulado/Chip), `components/simulator-tab.tsx` (novo), `components/shopper-tabs.tsx` (4ª aba "Simulador"), `page.tsx`, testes.
- Simulador: seletor de número simulado (vazio → orientação "Crie um cliente simulado na aba Números"); chat estilo WhatsApp do ponto de vista do cliente (mensagens do cliente à direita, da empresa à esquerda, ✓/✓✓ pelo status); caixa de texto + Enviar (Enter envia, Shift+Enter quebra linha); `refetchInterval` 3000; após enviar, invalida a query; aviso fixo pequeno: "Nada sai para o WhatsApp: este cliente só existe dentro do Sendtur."
- Mesmos padrões da parte 1 (TableCard com `minWidth` em classe, tokens, `getErrorMessage`, tabs com `aria-controls`).
- **Testes obrigatórios (static markup/puros):** helper que transforma mensagens em bolhas (lado e tique); aba Simulador aparece nas 4 tabs.
- Commit(s): `feat: aba Simulador do cliente oculto`.

### Task R: revisão final (API + web) e PRs
Revisor independente (spec + qualidade, foco: nenhum caminho envia contato simulado à Meta/telefone/webhook externo; contato normal intacto). Corrigir achados. PRs base `feat/conversation-tabs` (API e web). Deploy só com pedido explícito.
