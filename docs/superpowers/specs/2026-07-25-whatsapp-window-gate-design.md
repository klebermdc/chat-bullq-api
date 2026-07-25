# Design — Gate de janela 24h/72h + contador CTWA-aware

Data: 2026-07-25 · Achado 🔴 B da auditoria SSA (`_audit/05`, 5.2/5.5).

## Problema
1. **Nenhum gate no envio.** Texto livre pode ser enfileirado para um canal WhatsApp **oficial** com a janela de atendimento fechada → a Meta rejeita com `131047` (só surge como `failedReason`). Atinge principalmente cadência/automações (Aline/chatbot são reativos, quase sempre dentro da janela).
2. **Contador do inbox errado para CTWA.** O timer é **24h hardcoded no cliente** (`window-state.ts:3`). Leads vindos de anúncio Click-to-WhatsApp têm **72h** de janela grátis — mas o compositor trava neles às 24h, impedindo o vendedor de responder um lead que ainda está aberto.

## Modelo de janela (WhatsApp)
- **CSW (Customer Service Window) — 24h:** renova a cada mensagem do cliente. Dentro → texto livre; fora → só template (HSM).
- **Free Entry Point — 72h:** conversa iniciada por clique em anúncio CTWA (ou CTA de Página) abre janela grátis de 72h onde texto livre é permitido.
- **Janela efetiva de texto livre = `max(lastInboundAt + 24h, ctwaClidAt + 72h)`** (cada parcela só conta se o timestamp existir).
- Regra vale **só para `WHATSAPP_OFFICIAL`**. Wasender/Baileys (não-oficial) não têm essa restrição → intocados.

## Decisão de produto (aprovada)
Fora da janela, envio de **texto livre**:
- **Humano** → bloqueado e avisado (prevenção primária no compositor; backstop no servidor marca a msg com motivo claro, nunca `131047` genérico).
- **Automático (cadência/Aline/chatbot)** → não envia, segura/pula sem gastar tentativa.
- **Template** → passa sempre (é o permitido fora da janela).

Sem conversão automática para template. Sem costurar `metaConversationId → Conversation`. Sem migração de schema.

## Arquitetura

### 1. Util puro de janela (fonte única da verdade) — API
`src/modules/messaging/conversations/whatsapp-window.util.ts`
```ts
export interface WindowInput {
  channelType: string;            // ChannelType
  lastInboundAt: Date | null;
  ctwaClidAt: Date | null;
  now: Date;
}
export interface WindowState {
  applicable: boolean;            // channelType === WHATSAPP_OFFICIAL
  open: boolean;                  // now < expiresAt
  expiresAt: Date | null;        // max(lastInboundAt+24h, ctwaClidAt+72h); null se nada aplicável
  kind: 'csw24' | 'ctwa72' | null; // qual regra deu a janela maior
}
export function computeWhatsappWindow(input: WindowInput): WindowState;
```
- Sem dependências (Date puro) → testável isolado.
- `applicable=false` (canal não-oficial) ⇒ `open=true, expiresAt=null` (nunca bloqueia).
- Fonte v1 = **cálculo** com campos já existentes (`Conversation.lastInboundAt`, `Contact.ctwaClidAt`). Ressalva aceitável: lead CTWA detectado só por keyword-marker (sem `ctwaClidAt`) cai em 24h — conservador (não abre janela que talvez não exista).

### 2. Backstop no servidor — API
`OutboundMessageProcessor.process` (`messaging/pipeline/outbound-message.processor.ts`) — ponto **único** por onde todo envio passa (cadência, Aline, chatbot, proposta, humano). Antes de `adapter.sendMessage`:
1. Só age se `channel.type === WHATSAPP_OFFICIAL`.
2. Só age se o envio é **texto livre** (`message.type !== TEMPLATE`).
3. Carrega `Conversation` (→ `lastInboundAt`) + `Contact` (→ `ctwaClidAt`) da mensagem; roda `computeWhatsappWindow`.
4. Se **fechada**: NÃO chama o adapter; marca a `Message` como `FAILED` com `failedReason` claro (ex.: `"janela de 24h/72h fechada — envie um template"`); emite realtime de atualização; **retorna com sucesso (não lança)** para o BullMQ **não** re-tentar (a janela seguirá fechada).
5. Se aberta / template / não-oficial: fluxo normal.

> Prevenção do humano é primária na UI (item 4). Este backstop cobre stale-client + todos os caminhos automáticos que furam o `MessagesService.send`.

### 3. Expor a expiração para o inbox — API
Na serialização da conversa do inbox (lista/detalhe — localizar o serializer exato no plano; a query já inclui `contact`), adicionar campo computado:
- `windowExpiresAt: string | null` (ISO) e opcional `windowKind`.
- Computado via `computeWhatsappWindow` no servidor. Muda só quando `lastInboundAt`/`ctwaClidAt` mudam (o inbox já refaz fetch em mensagem nova).

### 4. Contador 72h-aware — Web
`chat-bullq-web/src/features/inbox/lib/window-state.ts` `computeWindowState`:
- Passa a usar `conversation.windowExpiresAt` (fonte servidor) em vez de `lastInboundAt + 24h` hardcoded.
- Fallback: se `windowExpiresAt` ausente (conversa antiga em cache), mantém o cálculo atual de 24h (back-compat, sem quebrar).
- `WindowChip` pode rotular a origem ("72h · anúncio") quando `windowKind === 'ctwa72'` (nice-to-have). Composer já desabilita via `windowClosed` — passa a respeitar as 72h automaticamente.

## Componentes e limites
| Unidade | Faz | Depende de | Testável |
|---|---|---|---|
| `whatsapp-window.util` | decide janela (puro) | nada | matriz unitária |
| gate no `OutboundMessageProcessor` | não deixa texto livre sair fora da janela | util + Prisma (conv/contact) | mock do adapter/prisma |
| serializer da conversa | expõe `windowExpiresAt` | util | unit no serializer |
| `computeWindowState` (web) | renderiza countdown | `windowExpiresAt` do servidor | unit |

## Testes
- **Util (API):** sem CTWA → 24h; CTWA → 72h; `max` das duas; canal não-oficial → `applicable=false/open=true`; expirado → `open=false`; timestamps nulos.
- **Gate (API):** texto+fechada → marca FAILED, NÃO chama adapter, NÃO re-tenta; texto+aberta → envia; template+fechada → envia; canal não-oficial → envia; CTWA dentro de 72h → envia.
- **Web:** `computeWindowState` usa `windowExpiresAt`; fallback 24h quando ausente.

## Fora de escopo (YAGNI)
- Não usa a tabela de billing `WhatsappWindow` (chaveada por `metaConversationId`, sem link com `Conversation`).
- Não converte texto→template automaticamente.
- Não mexe em Wasender/Baileys.
- Não adiciona coluna nova (usa `lastInboundAt` + `ctwaClidAt` existentes; `windowExpiresAt` é campo **computado** na serialização, não persistido).

## Riscos
- **Falso-bloqueio:** se `computeWhatsappWindow` errar, poderia segurar envio legítimo. Mitigado por: só afeta canal oficial + texto livre; `applicable=false` e timestamps nulos sempre resultam em "open"; matriz de teste cobre bordas.
- **CTWA sem `ctwaClidAt`** (keyword-marker) → tratado como 24h (conservador; pode travar 1 lead de anúncio raro cedo — aceitável, e o backstop só marca, não perde a intenção).
