# Design: Coexistência WhatsApp (número no app + Cloud API)

**Data:** 2026-07-28
**Status:** Proposta
**Depende de:** API #142 + Web #137 (guard do `/register`) mergeados

---

## Contexto

O Embedded Signup está no ar e validado ponta a ponta com um número novo de
Cloud API (Fase 1, 28/07). Falta o caso que motivou o projeto inteiro: o
**+55 11 5194-9395**, número real do negócio, que vive no app do WhatsApp
Business no celular da equipe e não pode sair de lá.

A Meta chama isso de **coexistência**: o mesmo número fala pelo app (conversa
um-a-um, no celular) e pela Cloud API (escala, automação, OFP Chat) ao mesmo
tempo. É um sub-fluxo do Embedded Signup, não um produto separado do lado da
Meta — mas do nosso lado exige quatro webhooks que hoje **não existem**.

### O que já foi resolvido

API #142 + Web #137: o `connect()` deixou de chamar `POST /{id}/register`
quando o desfecho é `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`. A doc é
explícita — *"skip the phone number registration step, as the number is already
registered"* — e cada chamada indevida queima a cota de 10 por 72h (erro
`133016` trava o registro por 3 dias). O canal fica marcado com
`coexistence: true` no `config`.

### O problema que sobra

Sem os quatro webhooks, conectar o número de produção não degrada a
experiência — **produz comportamento incorreto**. O caso mais grave:

> Um vendedor responde o cliente pelo celular. O OFP Chat não fica sabendo.
> A Aline enxerga um cliente sem resposta e reage; o card não move de etapa;
> a cadência de reengajamento dispara sobre uma conversa que está viva; o
> histórico da conversa mente para quem abrir o inbox.

Isso não é "faltar um recurso". É o sistema tomando decisão errada com
informação incompleta — a mesma família do apagão que o
[fail-loud do channel-hub](../../..) resolveu, só que silenciosa.

## Restrições impostas pela Meta

Levantadas da doc em 28/07, todas verificadas:

| Restrição | Efeito no produto |
|---|---|
| `/register` proibido | resolvido em API #142 |
| Prazo de **24h** pra sincronizar histórico | se estourar, o cliente precisa ser desconectado e refazer o fluxo |
| Throughput fixo de **20 mps** | limita disparo em massa neste canal |
| Grupo não sincroniza | conversa de grupo não existe no inbox |
| Lista de transmissão vira somente leitura | — |
| Mensagem temporária, ver-uma-vez e localização ao vivo **desligam** no número | mudança visível pro cliente; precisa ser avisada antes |
| Mensagem recebida **antes** do onboarding só pode ser respondida por template | afeta a primeira hora após conectar |
| App do WhatsApp Business **2.24.17+** no celular | pré-requisito operacional |
| Mídia do histórico só se enviada até **14 dias** antes do onboarding | histórico antigo vem sem anexo |
| Cota de onboarding: 10 clientes/7 dias → **200/semana** com Business Verification + App Review + Access Verification | temos os três; teto de 200 |

## Proposta

Quatro fatias independentes, cada uma entregável e testável sozinha, na ordem
de risco decrescente. Cada webhook novo entra como um campo a mais no
`WebhookParseResult`, sem mexer no caminho que já funciona.

```
Meta ──> /webhooks/WHATSAPP_OFFICIAL ──> WhatsAppOfficialInboundAdapter.parseWebhook
                                              │
        ┌─────────────────────────────────────┼──────────────────────────────┐
        │              │              │              │                       │
    messages       statuses     templateStatus   [NOVO] echoes          [NOVO] accountUpdates
    (existe)       (existe)       (existe)       [NOVO] historyChunks   [NOVO] contactSyncs
```

### Ponto de extensão

`WebhookParseResult` (`ports/types/normalized-message.types.ts:152`) já é um
envelope com campos opcionais — `templateStatusUpdates?` provou o padrão.
Cada fatia acrescenta um campo opcional e um ramo no
`webhook-gateway.controller.ts`. Zero mudança no fluxo de mensagem normal.

---

## Fatia 1 — `smb_message_echoes` (a que quebra tudo)

**Problema:** mensagem enviada pelo celular não chega ao OFP Chat.

**Proposta:** o echo vira uma `Message` com `direction: OUTBOUND` na conversa
correspondente, marcada como originada no app.

- Dedupe: `@@unique([conversationId, externalId])` (`schema.prisma:766`) já
  existe e é a chave — o `wamid` do echo é o mesmo id da mensagem. Um echo de
  mensagem que o próprio OFP Chat mandou pela Cloud API cai no upsert e não
  duplica.
- `metadata.source = 'smb_app'` distingue "mandada do celular" de "mandada do
  OFP Chat". A UI pode mostrar isso; o importante é o backend saber.
- `senderName`: sem identidade de usuário (o app não diz quem digitou).
  Registrar como envio do canal, não de um atendente — inventar um atendente
  seria pior que admitir que não sabemos.

**O que precisa mudar além de gravar a mensagem** (é aqui que mora o risco):

Um echo é uma **resposta humana**. Ele tem que produzir os mesmos efeitos
colaterais de um atendente respondendo pelo inbox:

1. desarmar a Aline na conversa (senão ela responde por cima do vendedor)
2. marcar a conversa como atendida / mexer no `awaitingHumanReply`
3. pausar cadência de reengajamento
4. mover o card, se a etapa depender de resposta

Cada um desses é um gancho existente. **A fatia não é "gravar a mensagem" — é
plugar o echo nos mesmos ganchos da resposta humana.** Se entregar só a
gravação, o sintoma visível some e o comportamento errado permanece: pior que
não fazer, porque fica invisível.

**Critério de aceite:** mandar mensagem pelo celular → aparece no inbox como
enviada em ≤5s, a Aline não responde por cima, a cadência pausa.

---

## Fatia 2 — `account_update` (dívida que virou obrigação)

Já era lacuna conhecida antes da coexistência: hoje o `parseWebhook` só trata
`message_template_status_update` (`whatsapp-official.inbound-adapter.ts:111`).
Na coexistência passa a ser **obrigatório** — é como se descobre que o cliente
desconectou.

**Eventos que importam:**

| Evento | Ação |
|---|---|
| `PARTNER_REMOVED` | cliente nos desconectou → desativar o canal e alertar |
| ban / restrição da WABA | alertar OWNER; canal para de funcionar de fato |
| mudança de tier de mensagens | registrar; afeta limite de disparo |
| qualidade do número | registrar; sinal de risco de ban |
| aprovação de nome de exibição | re-registro pode ser necessário (fora da coexistência) |

**Proposta:** auditar sempre + alertar o OWNER com o mesmo throttle de 15min
via Redis que o fail-loud do channel-hub já usa. Não inventar mecanismo novo.

Sem isso, o modo de falha é: cliente do Sendtur banido, ninguém sabe, ele
reclama dias depois que "parou de funcionar", e a investigação começa do zero.

---

## Fatia 3 — `history` (a maior, e a mais perigosa)

Até 180 dias de conversa um-a-um, empurrados pela Meta em fases/pedaços, com
**prazo de 24h** pra concluir.

**Reaproveitar o que existe.** Já há `ChannelSyncJob` (`schema.prisma:469`),
os enums `ChannelSyncMode`/`ChannelSyncStatus`, fila BullMQ
`CHANNEL_SYNC_QUEUE` e o `ChannelSyncOrchestrator` — construídos pro Zappfy
(é o "511 mensagens sincronizadas" do card). Os contadores
(`messagesImported`, `contactsImported`, `lastCursor`, `metadata`) servem
igual.

**A diferença que importa:** o sync do Zappfy é **pull** (a gente chama a API
deles); o histórico de coexistência é **push** (a Meta manda por webhook). O
`ChannelSyncJob` serve como máquina de estado e placar, mas quem alimenta é o
webhook, não o processor. Provavelmente cabe um `ChannelSyncMode.PUSH` novo.

**O risco que precisa de decisão explícita:** importar 180 dias de mensagens
num sistema que tem Aline, cadências, cards de lead, kanban, notificações e
webhooks de saída pode **disparar milhares de automações retroativas**. Um
lead de 4 meses atrás entrando como "mensagem nova" move card, dispara
cadência, notifica atendente e talvez faça a Aline responder alguém que já
comprou.

→ **A importação precisa de um caminho silencioso**: grava mensagem, cria
contato e conversa, e **não** aciona IA, cadência, automação, notificação nem
webhook de saída. Isso não é detalhe de implementação; é o requisito central
da fatia, e provavelmente exige um flag propagado por várias camadas.

**Prazo de 24h** vira requisito operacional: precisa de visibilidade do
progresso e de alerta se o job não concluir. Um `ChannelSyncJob` parado em
`RUNNING` por 24h significa que o cliente terá que refazer tudo.

---

## Fatia 4 — `smb_app_state_sync` (contatos)

Adição, edição e remoção de contatos no app do cliente. A menor das quatro.

Casar com `Contact` por telefone dentro da org. A chave
`@@unique([channelId, externalId])` (`schema.prisma:544`) já existe.

**Decisão pendente:** remoção de contato no celular **não** deve apagar o
`Contact` no OFP Chat — há conversa, card de lead e histórico pendurados nele.
Marcar como removido na origem e manter o registro.

---

## Alternativas consideradas

**Conectar o número de produção só com a Fatia 1.** Descartado: sem
`account_update`, uma desconexão do lado do cliente passa despercebida, e sem
`history` o inbox nasce vazio — o que confunde a equipe que espera ver as
conversas do celular.

**Migrar o número em vez de coexistir** (o "Caminho B" rejeitado em julho).
Continua descartado: tira o número do celular da equipe, que é justamente o
que não se quer.

**Adaptador novo separado do `whatsapp-official`.** Descartado: é o mesmo
canal, mesmo endpoint de webhook, mesma WABA. Um `coexistence: true` no config
basta pra gatear as diferenças de comportamento.

## Schema

- Fatias 1, 2 e 4: **nenhuma migração**. `Message.metadata` e `Channel.config`
  são `Json` e absorvem o que precisa.
- Fatia 3: possivelmente `ChannelSyncMode.PUSH`. ⚠️ `ALTER TYPE ADD VALUE` e
  uso do valor novo **na mesma migração** quebra o `migrate deploy` — ver
  [fix-cadence-revive-migration-quebrada]. Separar em duas migrações.

## Configuração na Meta (fora do código)

App Dashboard → WhatsApp → Configuração → assinar os quatro tópicos:
`history`, `smb_app_state_sync`, `smb_message_echoes`, `account_update`.

Isso **também é pré-requisito pro fluxo aparecer**: a doc diz que a tela de
seleção de WABA só é substituída pela opção de conectar conta existente quando
o app assina esses tópicos. Sem assinar, o caminho de coexistência nem é
oferecido ao cliente.

## Plano de rollback

Por fatia, todas aditivas: o campo novo no `WebhookParseResult` deixa de ser
preenchido e o ramo no gateway vira no-op. O fluxo de mensagem normal nunca
depende deles.

Para o canal: `deregister` ainda não existe (`POST /{id}/deregister`) — é a
saída limpa pra desconectar um cliente, e faz falta tanto aqui quanto no churn
do Sendtur.

## Tasks

**Fatia 1 — echoes**
1. [ ] `WebhookParseResult.echoes?` + parsing do `smb_message_echoes`
2. [ ] Persistir como `OUTBOUND` com upsert por `(conversationId, externalId)` e `metadata.source='smb_app'`
3. [ ] **Plugar nos ganchos de resposta humana** (Aline off, cadência pausa, card, `awaitingHumanReply`)
4. [ ] E2E: mandar do celular → aparece no inbox, Aline não responde por cima

**Fatia 2 — account_update**
5. [ ] Parsing + auditoria de todos os eventos
6. [ ] `PARTNER_REMOVED` → desativa o canal
7. [ ] Alerta ao OWNER com throttle de 15min (reusar o do fail-loud)

**Fatia 3 — history**
8. [ ] **Decidir e implementar o caminho silencioso de importação** (bloqueia o resto)
9. [ ] `ChannelSyncMode.PUSH` — migração separada do uso
10. [ ] Ingestão dos pedaços por fase, alimentando `ChannelSyncJob`
11. [ ] Progresso na UI + alerta se não concluir em 24h

**Fatia 4 — contatos**
12. [ ] `smb_app_state_sync` → upsert de `Contact`; remoção não apaga

**Transversal**
13. [ ] `deregister` (também serve ao churn do Sendtur)
14. [ ] Gatear comportamento por `config.coexistence` onde as restrições da Meta pedirem (20 mps, sem grupo)

## Riscos

| Risco | Mitigação |
|---|---|
| Importação retroativa dispara automação em massa | task 8 antes de qualquer ingestão; é a decisão que trava a fatia 3 |
| Echo não desarma a Aline → ela responde por cima do vendedor | task 3 é o coração da fatia 1, não um extra |
| Prazo de 24h estoura em silêncio | alerta na task 11 |
| Testar em produção: o número é o do negócio | fazer o E2E das fatias 1 e 2 num número de teste antes; a coexistência exige um número real em app, então provavelmente um chip separado |
| Cota de 10 registros/72h queimada por engano | já resolvido em API #142, mas vale relembrar ao operar |

## Fora de escopo

- Envio pela Cloud API respeitando os 20 mps (existe hoje, mas sem gate por canal)
- Importação de mídia além dos 14 dias (a Meta não fornece)
- Conversa de grupo (a Meta não sincroniza)
