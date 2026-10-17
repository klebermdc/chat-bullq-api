# Fatia 1 — Picker de Emoji no Compositor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao atendente um botão 😀 no compositor do inbox que insere emoji no texto, na posição do cursor.

**Architecture:** Componente de painel isolado (`emoji-picker-panel.tsx`) carregado sob demanda com `next/dynamic`, para que os ~600KB de dados do `emoji-mart` fiquem num chunk separado e não entrem no bundle inicial do inbox. A regra de inserção vive numa função pura (`insertAtCursor`) testada isoladamente — é onde mora o bug de verdade. O `chat-input.tsx` só liga as pontas.

**Tech Stack:** Next 16 · React 19 · TypeScript · Tailwind 4 · Headless UI 2 · `emoji-mart` · Vitest (introduzido aqui)

**Repositório:** `chat-bullq-web` · **Branch:** `feat/emoji-picker` (a partir de `fork/feat/conversation-tabs`)

---

## Contexto que o implementador precisa saber

- Este repositório **não tem nenhum teste hoje** — nenhum runner, nenhum arquivo
  `.test.ts`. A Task 1 introduz o Vitest configurado para **Node puro, sem jsdom
  e sem testing-library**. Não instale jsdom nem `@testing-library/react`: a única
  coisa testada aqui é uma função pura de string.
- `ChatInputHandle.insertText` **já existe** em `chat-input.tsx:99` e **não serve**
  para emoji: ele acrescenta o texto numa **linha nova no fim**
  (`chat-input.tsx:203-214`), que é o comportamento certo para sugestão da IA e
  template. Emoji precisa entrar **na posição do cursor**. São regras diferentes;
  não tente reaproveitar.
- O botão é **só desktop** (`hidden lg:flex`). No celular o teclado do sistema já
  tem tecla de emoji — um picker próprio ali seria redundante e abriria um popover
  dentro do BottomSheet.
- **Armadilha conhecida deste projeto:** nunca use `autoFocus` em campo dentro de
  `PopoverPanel`. O React aplica `autoFocus` na fase de layout, antes do portal
  aninhado se registrar, e o popover pai entende como "foco fora" e se fecha — o
  painel abre e fecha no mesmo clique. O padrão do projeto é focar num `useEffect`;
  veja o comentário em `src/features/inbox/components/agent-pin-popover.tsx:20-31`.
  Por isso o `<Picker>` vai com `autoFocus={false}`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/features/inbox/lib/text-insert.ts` *(criar)* | Função pura `insertAtCursor`. Sem React, sem DOM. |
| `src/features/inbox/lib/text-insert.test.ts` *(criar)* | Testes da função pura. |
| `src/features/inbox/components/emoji-picker-panel.tsx` *(criar)* | Renderiza o `emoji-mart` e devolve o emoji escolhido. Não sabe o que é um compositor. Na Fatia 2 ele vira o conteúdo da aba *Emojis* de um painel com abas — por isso ele não desenha borda, sombra nem cabeçalho próprio. |
| `src/features/inbox/components/chat-input.tsx` *(modificar)* | Botão 😀 + popover + aplicação da inserção no textarea. |
| `vitest.config.ts` *(criar)* | Config do runner. |
| `package.json` *(modificar)* | Deps do emoji-mart, devDep do Vitest, script `test`. |

---

## Task 1: Função pura de inserção no cursor

**Files:**
- Create: `src/features/inbox/lib/text-insert.ts`
- Test: `src/features/inbox/lib/text-insert.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Instalar o Vitest**

```bash
cd chat-bullq-web
yarn add -D vitest
```

> Este projeto usa **yarn** (o Dockerfile depende disso). Não use `npm install`.

- [ ] **Step 2: Criar a config do runner**

Criar `vitest.config.ts` na raiz de `chat-bullq-web`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node puro: o que testamos aqui é lógica de string, não componente.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Adicionar o script de teste**

Em `package.json`, dentro de `"scripts"`, acrescentar a linha `test`:

```json
"scripts": {
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "gen:icons": "node scripts/gen-icons.mjs"
}
```

- [ ] **Step 4: Escrever os testes que falham**

Criar `src/features/inbox/lib/text-insert.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { insertAtCursor } from './text-insert';

describe('insertAtCursor', () => {
  it('insere no meio do texto e devolve o cursor depois do emoji', () => {
    const r = insertAtCursor('bom dia', 3, 3, '😀');
    expect(r.text).toBe('bom😀 dia');
    expect(r.caret).toBe(3 + '😀'.length);
  });

  it('insere no fim quando o cursor está no fim', () => {
    const r = insertAtCursor('oi', 2, 2, '👍');
    expect(r.text).toBe('oi👍');
    expect(r.caret).toBe(2 + '👍'.length);
  });

  it('insere em texto vazio', () => {
    const r = insertAtCursor('', 0, 0, '🎉');
    expect(r.text).toBe('🎉');
    expect(r.caret).toBe('🎉'.length);
  });

  it('substitui a seleção quando há texto selecionado', () => {
    const r = insertAtCursor('bom dia', 0, 3, '👋');
    expect(r.text).toBe('👋 dia');
    expect(r.caret).toBe('👋'.length);
  });

  it('trata seleção invertida (usuário arrastou da direita para a esquerda)', () => {
    const r = insertAtCursor('bom dia', 3, 0, '👋');
    expect(r.text).toBe('👋 dia');
    expect(r.caret).toBe('👋'.length);
  });

  it('limita índices maiores que o texto em vez de gerar "undefined"', () => {
    const r = insertAtCursor('oi', 99, 99, '🙂');
    expect(r.text).toBe('oi🙂');
    expect(r.caret).toBe(2 + '🙂'.length);
  });

  it('limita índices negativos', () => {
    const r = insertAtCursor('oi', -5, -5, '🙂');
    expect(r.text).toBe('🙂oi');
    expect(r.caret).toBe('🙂'.length);
  });
});
```

- [ ] **Step 5: Rodar os testes e confirmar que falham**

Run: `yarn test`
Expected: FAIL — `Failed to resolve import "./text-insert"`.

- [ ] **Step 6: Escrever a implementação mínima**

Criar `src/features/inbox/lib/text-insert.ts`:

```ts
export interface CursorInsertResult {
  /** Texto já com o trecho inserido. */
  text: string;
  /** Onde o cursor deve ficar depois da inserção. */
  caret: number;
}

/**
 * Insere `insert` em `text` na posição do cursor, substituindo o que estiver
 * selecionado.
 *
 * `selectionStart`/`selectionEnd` vêm direto do textarea e não são confiáveis:
 * podem vir invertidos (seleção feita da direita para a esquerda) ou fora do
 * intervalo do texto. Por isso são normalizados antes do slice — sem isso o
 * `slice` devolve string vazia silenciosamente e o texto do atendente some.
 */
export function insertAtCursor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  insert: string,
): CursorInsertResult {
  const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
  const a = clamp(selectionStart);
  const b = clamp(selectionEnd);
  const start = Math.min(a, b);
  const end = Math.max(a, b);

  return {
    text: text.slice(0, start) + insert + text.slice(end),
    caret: start + insert.length,
  };
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `yarn test`
Expected: PASS — 7 testes.

- [ ] **Step 8: Commit**

```bash
git add package.json yarn.lock vitest.config.ts src/features/inbox/lib/text-insert.ts src/features/inbox/lib/text-insert.test.ts
git commit -m "test: insercao de texto na posicao do cursor + Vitest no repo web"
```

---

## Task 2: Painel do picker

**Files:**
- Create: `src/features/inbox/components/emoji-picker-panel.tsx`
- Modify: `package.json`

- [ ] **Step 1: Instalar o emoji-mart**

```bash
cd chat-bullq-web
yarn add emoji-mart @emoji-mart/data @emoji-mart/react
```

- [ ] **Step 2: Criar o componente**

Criar `src/features/inbox/components/emoji-picker-panel.tsx`:

```tsx
'use client';

import { useTheme } from 'next-themes';
import data from '@emoji-mart/data';
import i18nPt from '@emoji-mart/data/i18n/pt.json';
import Picker from '@emoji-mart/react';

interface Props {
  /** Recebe o emoji já pronto para inserir (ex.: "😀"). */
  onPick: (emoji: string) => void;
}

/**
 * Só renderiza o picker e devolve a escolha. Não sabe o que é compositor nem
 * como inserir texto — quem liga as pontas é o `chat-input`.
 *
 * O import dos dados do emoji-mart é estático DE PROPÓSITO: este arquivo inteiro
 * é carregado com `next/dynamic` lá no `chat-input`, então o JSON pesado fica
 * num chunk separado que só baixa quando o atendente abre o painel pela primeira
 * vez.
 */
export function EmojiPickerPanel({ onPick }: Props) {
  const { resolvedTheme } = useTheme();

  return (
    <Picker
      data={data}
      i18n={i18nPt}
      locale="pt"
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      onEmojiSelect={(emoji: { native: string }) => onPick(emoji.native)}
      previewPosition="none"
      skinTonePosition="search"
      navPosition="top"
      perLine={8}
      /**
       * NUNCA ligar isto. Campo com autoFocus dentro de PopoverPanel faz o
       * popover se fechar no mesmo clique que abriu — ver o comentário em
       * agent-pin-popover.tsx.
       */
      autoFocus={false}
    />
  );
}
```

- [ ] **Step 3: Verificar que compila**

Run: `yarn build`
Expected: build conclui sem erro de tipo. Se o TS reclamar de tipos de
`@emoji-mart/react` ou do import de `.json`, criar `src/types/emoji-mart.d.ts`:

```ts
declare module '@emoji-mart/react';
declare module '@emoji-mart/data';
declare module '@emoji-mart/data/i18n/pt.json';
```

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock src/features/inbox/components/emoji-picker-panel.tsx src/types/emoji-mart.d.ts
git commit -m "feat(inbox): painel de emoji isolado (emoji-mart, pt-BR)"
```

---

## Task 3: Ligar o botão 😀 no compositor

**Files:**
- Modify: `src/features/inbox/components/chat-input.tsx`

- [ ] **Step 1: Adicionar os imports**

Em `chat-input.tsx`, no bloco de imports do `lucide-react` (linhas 11-29),
acrescentar `Smile` à lista:

```tsx
import {
  Send,
  Paperclip,
  Mic,
  Trash2,
  Square,
  Loader2,
  FileText,
  Film,
  X,
  LayoutTemplate,
  Clock,
  Plane,
  Trophy,
  PackageCheck,
  FolderOpen,
  Smartphone,
  Plus,
  Smile,
} from 'lucide-react';
```

Logo abaixo dos imports existentes, acrescentar:

```tsx
import dynamic from 'next/dynamic';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { insertAtCursor } from '../lib/text-insert';

/**
 * Carregado sob demanda: os dados do emoji-mart são grandes e não podem entrar
 * no bundle inicial do inbox.
 */
const EmojiPickerPanel = dynamic(
  () => import('./emoji-picker-panel').then((m) => m.EmojiPickerPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[380px] w-[352px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);
```

- [ ] **Step 2: Adicionar o handler de inserção**

Em `chat-input.tsx`, logo depois de `clearTextarea` (por volta da linha 228),
acrescentar:

```tsx
/**
 * Insere o emoji onde o cursor está e devolve o foco ao textarea com o cursor
 * DEPOIS do emoji. Sem reposicionar o cursor à mão, o navegador joga o cursor
 * para o fim a cada emoji — escolher dois emojis no meio da frase inverteria a
 * ordem deles.
 *
 * O painel não é fechado de propósito: o atendente costuma escolher mais de um.
 */
const handlePickEmoji = useCallback((emoji: string) => {
  const el = textareaRef.current;
  const start = el?.selectionStart ?? text.length;
  const end = el?.selectionEnd ?? text.length;
  const { text: next, caret } = insertAtCursor(text, start, end, emoji);

  setText(next);
  requestAnimationFrame(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(caret, caret);
    node.style.height = 'auto';
    node.style.height = Math.min(node.scrollHeight, 160) + 'px';
  });
}, [text]);
```

- [ ] **Step 3: Adicionar o botão na barra de ações do desktop**

Em `chat-input.tsx`, dentro da `<div className="hidden items-end gap-2 lg:flex">`
(linha 571), **antes** do `<Dropdown>` do clipe (linha 572), inserir:

```tsx
<Popover className="relative">
  <PopoverButton
    as="button"
    type="button"
    className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 lg:mb-1 lg:h-auto lg:w-auto lg:p-2"
    title="Emoji"
    aria-label="Inserir emoji"
  >
    <Smile className="h-5 w-5" />
  </PopoverButton>
  <PopoverPanel
    anchor="top start"
    className="z-50 rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
  >
    <EmojiPickerPanel onPick={handlePickEmoji} />
  </PopoverPanel>
</Popover>
```

- [ ] **Step 4: Conferir que o botão respeita a janela fechada**

Localizar em `chat-input.tsx` a condição que já esconde os controles de envio
quando `windowClosed` é verdadeiro (a mesma que governa o textarea e o clipe) e
garantir que o `<Popover>` acima está **dentro** dela. Se o clipe está escondido
com a janela fechada, o emoji também tem que estar — inserir emoji num textarea
bloqueado é um controle morto.

- [ ] **Step 5: Verificar o build e o lint**

Run: `yarn build && yarn lint`
Expected: ambos sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/features/inbox/components/chat-input.tsx
git commit -m "feat(inbox): botao de emoji no compositor (desktop)"
```

---

## Task 4: Verificação manual no navegador

**Files:** nenhum

Não há teste de componente neste repositório, então esta verificação é a rede de
proteção da parte visual. Rodar `yarn dev` e abrir uma conversa no inbox.

- [ ] **Step 1:** Clicar no 😀 — o painel abre e **continua aberto** (se abrir e
      fechar sozinho, é o problema de `autoFocus` descrito no topo deste plano).
- [ ] **Step 2:** Com o campo vazio, escolher um emoji → ele aparece no textarea.
- [ ] **Step 3:** Digitar `bom dia`, posicionar o cursor entre `bom` e ` dia`,
      escolher um emoji → o resultado é `bom😀 dia`, **não** `bom dia😀`.
- [ ] **Step 4:** Escolher um segundo emoji em seguida, sem fechar o painel → ele
      entra logo depois do primeiro, na ordem em que foram clicados.
- [ ] **Step 5:** Selecionar a palavra `bom` e escolher um emoji → a palavra é
      substituída pelo emoji.
- [ ] **Step 6:** Enviar a mensagem → o emoji chega no WhatsApp do cliente.
- [ ] **Step 7:** Alternar o tema para escuro → o painel acompanha.
- [ ] **Step 8:** Abrir o inbox no celular (ou reduzir a janela abaixo de `lg`) →
      o botão 😀 **não** aparece, e o compositor não fica espremido.
- [ ] **Step 9:** Abrir uma conversa com a janela de 24h fechada → o botão 😀 não
      aparece, igual ao clipe.

---

## Task 5: Abrir o PR

- [ ] **Step 1: Subir a branch**

```bash
git push -u origin feat/emoji-picker
```

- [ ] **Step 2: Abrir o PR contra a branch viva**

```bash
gh pr create --base feat/conversation-tabs \
  --title "feat(inbox): picker de emoji no compositor" \
  --body "Fatia 1 da spec docs/superpowers/specs/2026-07-27-emoji-sticker-reacao-design.md

Botão 😀 no compositor (desktop) que insere emoji na posição do cursor.
Não toca a API — mensagem sai como TEXT normal.

Introduz o Vitest no repo web, configurado para Node puro (sem jsdom),
testando só a função de inserção no cursor.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

> Não empurrar direto na `feat/conversation-tabs` — é a branch de deploy.
