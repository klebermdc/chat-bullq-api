# Emoji, Figurinha e Reação no compositor — Design

**Data:** 2026-07-27
**Status:** aprovado, pronto para plano de implementação
**Branch:** `feat/emoji-sticker-reaction`

## Problema

O atendente não tem como enviar emoji, figurinha ou reação pelo inbox. Hoje ele
digita texto puro. O cliente do outro lado usa WhatsApp normal — manda figurinha e
reage a mensagens — e a conversa fica assimétrica.

## O que já existe

Levantamento feito na branch viva `fork/feat/conversation-tabs`:

- **Figurinha recebida já renderiza** — `MediaSticker` em
  `chat-bullq-web/src/features/inbox/components/media-bubbles.tsx`, acionado por
  `msg.type === 'STICKER'` em `chat-panel.tsx`.
- **Figurinha enviada já está mapeada nos adapters** — o Wasender monta
  `{ to, stickerUrl }` em `wasender.message-mapper.ts` (`case MessageContentType.STICKER`).
- **`image/webp` já passa no upload** — `ALLOWED_MEDIA_MIME` em
  `src/modules/messaging/messages/uploads.service.ts`.
- **Reação recebida já renderiza** — `msg.content.reaction.emoji` em `chat-panel.tsx:970`.
- **`MessageContentType.REACTION` já existe** no port
  (`src/modules/channel-hub/ports/types/normalized-message.types.ts`) e já é
  tratado na saída pelos adapters `whatsapp-official` e `zappfy`.
- **Não há biblioteca de emoji** no `package.json` da web.

### O que trava hoje

1. O DTO de envio aceita só `TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, TEMPLATE`
   (`src/modules/messaging/messages/dto/send-message.dto.ts`). `STICKER` e
   `REACTION` são rejeitados antes de chegar no adapter.
2. O Wasender/Baileys **não mapeia `REACTION` na saída** — cai no `default` do
   `denormalize()` e enviaria o emoji como mensagem de texto solta. É um bug
   latente, não um recurso faltando.

### Restrição do provedor

A documentação pública da WasenderAPI expõe `send-message` (texto, imagem, vídeo,
documento, áudio, **figurinha**), contato, localização, enquete, editar, apagar e
marcar como lida — e reação **apenas como webhook de entrada**. Não há endpoint de
envio de reação.

**Consequência:** figurinha funciona em todos os canais; reação só em Meta oficial
e Zappfy.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Fonte da figurinha | Pasta marcada na Biblioteca de Arquivos | Reusa `MediaAsset` + `MediaFolder`; nenhuma conversão de imagem na API; figurinha de marca padronizada. |
| Reação onde não há suporte | Esconder o botão | Nada de controle que falha. Canal sem suporte nem mostra a opção. |
| Entrada na UI | Um botão 😀 com abas `[Emojis｜Figurinhas]` | O compositor já tem 8 controles e passou por um declutter. Um botão novo, padrão que o atendente já conhece do WhatsApp Web. |
| Biblioteca de emoji | `emoji-mart` via `next/dynamic` | Busca e i18n pt-BR; dados vêm de pacote npm, não de CDN em runtime (evita a classe de falha de rede/CORS que já derrubou o app antes); carrega só ao abrir o painel. |
| Identificar figurinha | `MediaFolder.isStickerFolder` | Coluna booleana, migration trivial, sem backfill. Sobrevive a renomear a pasta — diferente de convenção de nome — e não confunde um logo `.webp` com figurinha. |

## Fatiamento

Três entregas independentes, no formato de PR já usado no projeto:

| Fatia | Entrega | Repos |
|---|---|---|
| **1 — Emoji** | Painel 😀 no compositor; emoji entra no textarea e vira mensagem `TEXT`. | Web |
| **2 — Figurinha** | Aba "Figurinhas"; envia `STICKER` da Biblioteca. | API + Web |
| **3 — Reação** | 👍 na bolha, só em canal capaz. | API + Web |

A Fatia 1 não toca a API e sobe sozinha. A Fatia 3 é a de maior risco e vai por último.

## Arquitetura

### Web

**`emoji-sticker-popover.tsx`** (novo, `src/features/inbox/components/`)

Popover com duas abas. Uma responsabilidade: escolher um emoji ou uma figurinha e
devolver a escolha. Não sabe enviar mensagem.

```
Props:
  onPickEmoji(emoji: string): void
  onPickSticker(asset: MediaAsset): void
  stickersEnabled: boolean
```

- Aba *Emojis*: `emoji-mart` + `@emoji-mart/react` + `@emoji-mart/data`,
  importado com `next/dynamic({ ssr: false })`, `i18n` pt-BR, tema derivado do
  `next-themes`.
- Aba *Figurinhas*: `useQuery` → `GET /media-library/stickers` → grid de
  miniaturas de 64px.

**`chat-input.tsx`** (alterado)

- Botão `Smile` (lucide) ao lado do clipe. No mobile entra como item do
  BottomSheet "+", não como ícone novo na barra.
- `onPickEmoji` → insere o emoji **na posição do cursor** do textarea (o
  componente já expõe `ref` via `useImperativeHandle`), mantém o foco e **não
  fecha** o painel, permitindo escolher vários seguidos.
- `onPickSticker` → envia imediatamente e fecha o painel. Figurinha **não** passa
  pela bandeja de anexos: é envio de um clique, como no WhatsApp.

**`message-reaction-bar.tsx`** (novo)

- Aparece no hover da bolha (desktop) e no long-press (mobile).
- Seis emojis rápidos: 👍 ❤️ 😂 😮 😢 🙏, mais um "…" que abre o mesmo picker.
- Só renderiza quando o canal da conversa tem `capabilities.reactions === true`.
- A leitura da reação já existe em `chat-panel.tsx:970`; o envio reaproveita o
  mesmo caminho de render.

### API

**DTO** — `send-message.dto.ts` ganha `STICKER` e `REACTION` no enum, nos **dois**
lugares: o `@ApiProperty({ enum: [...] })` e o `@IsEnum([...])`. Alterar só um
deles deixa o Swagger mentindo ou a validação frouxa.

**Capabilities por canal** — mapa estático em `channel-hub`:

| Adapter | stickers | reactions |
|---|---|---|
| `wasender` | ✅ | ❌ |
| `whatsapp-official` | ✅ | ✅ |
| `zappfy` | ✅ | ✅ |

Exposto no payload de `GET /channels` (que o inbox já carrega) como
`capabilities: { stickers: boolean; reactions: boolean }`, para a UI decidir o que
mostrar — **e** validado no envio. Esconder o botão é conveniência de interface; a
autoridade é o servidor: canal sem suporte responde `400`.

**Validação de conteúdo por tipo** — hoje `content` é `Record<string, any>` sem
guarda alguma. Passa a valer:

- `STICKER` exige `content.mediaUrl` **que resolva para um `MediaAsset` da própria
  organização** — busca por `url` em `media_assets` filtrando pelo
  `organizationId` do request, com `deletedAt: null`. Hoje uma URL arbitrária
  passaria direto para o provedor: é vazamento entre tenants e superfície de SSRF.
  Sem correspondência → `403`.
- `REACTION` exige `replyToMessageId` (a mensagem alvo) e
  `content.reaction.emoji` com exatamente um grafema. Faltando qualquer um → `400`.

**Correção do bug latente** — no `denormalize()` do `wasender.message-mapper.ts`, o
`default` que hoje converteria `REACTION` em texto passa a lançar erro explícito
para tipos não suportados pelo canal.

**Prisma** — `MediaFolder.isStickerFolder Boolean @default(false) @map("is_sticker_folder")`.
Sem backfill: nenhuma pasta existente é de figurinha até alguém marcar.

**Endpoint** — `GET /media-library/stickers` devolve os assets de pastas com
`isStickerFolder = true`, escopado por `organizationId` como todo o resto do módulo.

**UI da Biblioteca** — checkbox "Esta pasta é de figurinhas" ao criar e editar pasta.

### Fluxo de dados

**Emoji** — clique → insere no cursor → textarea → envio `TEXT` pelo caminho
existente. A API não muda.

**Figurinha** — clique → `POST /messages { type: 'STICKER', content: { mediaUrl } }`
→ service valida que o asset é da org → adapter monta `{ to, stickerUrl }`.

**Reação** — clique no emoji → `POST /messages { type: 'REACTION', replyToMessageId,
content: { reaction: { emoji } } }` → service resolve o `externalMessageId` da
mensagem alvo (caminho que já existe para o "Responder") → adapter oficial monta o
payload de reaction com o `message_id`.

## Janela de 24h

Figurinha e reação são mensagens de saída como qualquer outra e passam pelo gate de
janela que já existe. Com a janela fechada, o botão 😀 e a barra de reação somem
junto com os demais controles de envio.

## Erros

| Situação | Resposta |
|---|---|
| Asset de figurinha de outra organização | `403` |
| `REACTION` sem `replyToMessageId` ou sem emoji válido | `400` |
| Canal não suporta o tipo | `400` (e o controle nem aparece na UI) |
| Falha no envio ao provedor | mensagem entra como `FAILED` pelo fluxo existente |

## Testes

- `send-message.dto` — aceita `STICKER` e `REACTION`; rejeita tipo desconhecido.
- `messages.service` — asset de outra org → `403`; reação sem alvo → `400`; canal
  sem capability → `400`.
- `wasender.message-mapper` — **regressão**: `REACTION` nunca vira mensagem de
  texto. Este é o teste que mais importa: protege contra o bug latente voltar.
- `wasender.message-mapper` — `STICKER` produz `{ to, stickerUrl }`.
- `whatsapp-official.message-mapper` — `REACTION` monta o payload com `message_id`.
- Web — inserção de emoji respeita a posição do cursor no meio de um texto existente.

## Fora de escopo

Deliberadamente de fora, para manter cada fatia entregável:

- Converter PNG/JPG em figurinha na hora (exigiria processamento de imagem na API).
- Figurinha animada.
- Remover ou trocar uma reação já enviada.
- Reação disparada pela Aline (agente de IA).
- Emojis recentes sincronizados entre dispositivos — o `emoji-mart` já guarda os
  recentes em `localStorage`, o que basta.
