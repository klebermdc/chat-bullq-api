# Fatia 2 — Enviar Figurinha da Biblioteca

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O atendente abre a aba "Figurinhas" no painel do compositor, clica numa figurinha e ela sai como `STICKER` no WhatsApp do cliente.

**Architecture:** A pasta da Biblioteca ganha um flag `isStickerFolder`. Um endpoint novo devolve só os assets dessas pastas. O DTO de envio passa a aceitar `STICKER`, e o service verifica que a `mediaUrl` pertence a um asset da própria organização antes de mandar para o provedor. O adapter já sabe enviar figurinha — nada a fazer lá.

**Tech Stack:** NestJS · Prisma 6 · Postgres · Jest (API) · Next 16 · React Query (web)

**Repositórios:** `chat-bullq-api` (branch `feat/sticker-send-api`) e `chat-bullq-web` (branch `feat/sticker-send-web`), ambos a partir de `fork/feat/conversation-tabs`.

**Depende da Fatia 1** (o painel de emoji já existir, para virar painel com abas).

---

## Contexto que o implementador precisa saber

- **O envio de figurinha já funciona no adapter.** `wasender.message-mapper.ts`
  já tem `case MessageContentType.STICKER: return { endpoint, payload: { to, stickerUrl } }`.
  O que bloqueia é só o DTO. Não escreva mapper novo.
- **`image/webp` já é aceito** no upload da Biblioteca
  (`MediaLibraryService.ALLOWED_MIME`) e no upload de mensagem. Nada a mudar.
- **O gate de janela de 24h já cobre figurinha**: o
  `WhatsappWindowGate.blockIfClosed` libera só `TEMPLATE` em canal oficial, então
  `STICKER` fora da janela já vira `FAILED` sozinho. Não escreva regra nova.
- **Multitenancy é por `organizationId`, na query.** Este projeto **não** usa RLS
  e **não** é Supabase. Todo `findFirst`/`findMany` precisa do `organizationId`
  no `where` — é a única barreira que existe.
- **A migration aqui é uma coluna booleana com default.** Não é `ALTER TYPE ADD
  VALUE`, então não corre o risco que quebrou a migration `cadence_revive`.
- Não existe endpoint de editar pasta hoje (só criar e apagar). A Task 3 cria o
  `PATCH`, senão não há como marcar uma pasta que já existe nem corrigir um erro.

## Estrutura de arquivos

### API (`chat-bullq-api`)

| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` *(modificar)* | Coluna `isStickerFolder` em `MediaFolder`. |
| `prisma/migrations/20260727180000_media_folder_is_sticker/migration.sql` *(criar)* | A migration. |
| `src/modules/media-library/dto/create-folder.dto.ts` *(modificar)* | Campo opcional no create. |
| `src/modules/media-library/dto/update-folder.dto.ts` *(criar)* | DTO do PATCH. |
| `src/modules/media-library/media-library.repository.ts` *(modificar)* | `updateFolder`, `findStickerAssets`. |
| `src/modules/media-library/media-library.service.ts` *(modificar)* | `updateFolder`, `listStickers`. |
| `src/modules/media-library/media-library.controller.ts` *(modificar)* | `PATCH folders/:id`, `GET stickers`. |
| `src/modules/messaging/messages/dto/send-message.dto.ts` *(modificar)* | `STICKER` no enum. |
| `src/modules/messaging/messages/sticker-guard.ts` *(criar)* | Valida que a `mediaUrl` é asset da org. Função isolada, testável sem subir o service inteiro. |
| `src/modules/messaging/messages/sticker-guard.spec.ts` *(criar)* | Testes do guard. |
| `src/modules/messaging/messages/messages.service.ts` *(modificar)* | Chama o guard no `send()`. |

### Web (`chat-bullq-web`)

| Arquivo | Responsabilidade |
|---|---|
| `src/features/media-library/services/media-library.service.ts` *(modificar)* | `listStickers()`, `isStickerFolder` no tipo. |
| `src/features/inbox/components/sticker-grid.tsx` *(criar)* | Grid de figurinhas; devolve a escolhida. |
| `src/features/inbox/components/emoji-sticker-popover.tsx` *(criar)* | Abas `[Emojis｜Figurinhas]`; embrulha o painel da Fatia 1 e o grid. |
| `src/features/inbox/components/chat-input.tsx` *(modificar)* | Passa a usar o popover com abas; envia a figurinha. |
| `src/features/media-library/components/media-library-dialog.tsx` *(modificar)* | Checkbox "pasta de figurinhas" ao criar pasta + alternar em pasta existente. |

---

# PARTE A — API

## Task 1: Coluna `isStickerFolder`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260727180000_media_folder_is_sticker/migration.sql`

- [ ] **Step 1: Adicionar o campo no schema**

Em `prisma/schema.prisma`, no `model MediaFolder`, acrescentar a linha
`isStickerFolder` logo depois de `name`:

```prisma
model MediaFolder {
  id             String    @id @default(cuid())
  organizationId String    @map("organization_id")
  name           String
  /// Pasta de figurinhas: seus .webp aparecem na aba "Figurinhas" do compositor.
  isStickerFolder Boolean  @default(false) @map("is_sticker_folder")
  createdById    String?   @map("created_by_id")
  createdAt      DateTime  @default(now()) @map("created_at")
  deletedAt      DateTime? @map("deleted_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  assets       MediaAsset[]

  @@index([organizationId, deletedAt])
  @@map("media_folders")
}
```

- [ ] **Step 2: Escrever a migration à mão**

Criar `prisma/migrations/20260727180000_media_folder_is_sticker/migration.sql`:

```sql
ALTER TABLE "media_folders"
  ADD COLUMN "is_sticker_folder" BOOLEAN NOT NULL DEFAULT false;
```

> Sem backfill de propósito: nenhuma pasta existente vira pasta de figurinha até
> alguém marcar.

- [ ] **Step 3: Aplicar e gerar o client**

Run: `yarn prisma migrate dev && yarn prisma:generate`
Expected: migration aplicada, client regenerado sem erro.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260727180000_media_folder_is_sticker
git commit -m "feat(media-library): flag isStickerFolder na pasta"
```

---

## Task 2: Guard de figurinha (TDD)

Esta é a task mais importante da fatia — é o que impede uma URL arbitrária de
ser repassada ao provedor.

**Files:**
- Create: `src/modules/messaging/messages/sticker-guard.ts`
- Test: `src/modules/messaging/messages/sticker-guard.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/modules/messaging/messages/sticker-guard.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertStickerAllowed } from './sticker-guard';

describe('assertStickerAllowed', () => {
  const orgId = 'org-1';

  function prismaWith(asset: any) {
    return {
      mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
    } as any;
  }

  it('aceita figurinha cujo asset é da própria organização', async () => {
    const prisma = prismaWith({ id: 'a1', mimeType: 'image/webp' });
    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: 'https://x/y.webp' }),
    ).resolves.toBeUndefined();

    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: { url: 'https://x/y.webp', organizationId: orgId, deletedAt: null },
      select: { id: true, mimeType: true },
    });
  });

  it('recusa quando não existe asset com aquela url na organização', async () => {
    const prisma = prismaWith(null);
    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: 'https://evil/x.webp' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa quando falta mediaUrl', async () => {
    const prisma = prismaWith(null);
    await expect(
      assertStickerAllowed(prisma, orgId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa asset que não é webp — WhatsApp só aceita webp como figurinha', async () => {
    const prisma = prismaWith({ id: 'a1', mimeType: 'image/png' });
    await expect(
      assertStickerAllowed(prisma, orgId, { mediaUrl: 'https://x/y.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `yarn test sticker-guard`
Expected: FAIL — `Cannot find module './sticker-guard'`.

- [ ] **Step 3: Implementar**

Criar `src/modules/messaging/messages/sticker-guard.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Garante que a figurinha que vai sair é um arquivo da própria organização.
 *
 * Sem isto, `content.mediaUrl` é uma string livre que o service repassa direto
 * ao provedor: daria para mandar a URL de um asset de OUTRA organização (ou uma
 * URL interna qualquer) e o WhatsApp buscaria esse conteúdo. Este projeto não
 * tem RLS — a barreira de tenant é o `organizationId` no where, e só.
 */
export async function assertStickerAllowed(
  prisma: PrismaService,
  organizationId: string,
  content: Record<string, any>,
): Promise<void> {
  const mediaUrl = content?.mediaUrl;
  if (typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
    throw new BadRequestException('Figurinha exige content.mediaUrl');
  }

  const asset = await prisma.mediaAsset.findFirst({
    where: { url: mediaUrl, organizationId, deletedAt: null },
    select: { id: true, mimeType: true },
  });

  if (!asset) {
    throw new ForbiddenException(
      'Esta figurinha não pertence à sua organização',
    );
  }

  if (asset.mimeType !== 'image/webp') {
    throw new BadRequestException(
      'Figurinha precisa ser .webp — o WhatsApp rejeita outros formatos',
    );
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `yarn test sticker-guard`
Expected: PASS — 4 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/messages/sticker-guard.ts src/modules/messaging/messages/sticker-guard.spec.ts
git commit -m "feat(messages): guard de figurinha (asset precisa ser da org)"
```

---

## Task 3: Endpoints da Biblioteca

**Files:**
- Modify: `src/modules/media-library/dto/create-folder.dto.ts`
- Create: `src/modules/media-library/dto/update-folder.dto.ts`
- Modify: `src/modules/media-library/media-library.repository.ts`
- Modify: `src/modules/media-library/media-library.service.ts`
- Modify: `src/modules/media-library/media-library.controller.ts`

- [ ] **Step 1: Campo opcional no create**

Em `src/modules/media-library/dto/create-folder.dto.ts`, acrescentar:

```ts
  @ApiPropertyOptional({
    description: 'Pasta de figurinhas: seus .webp aparecem no compositor',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isStickerFolder?: boolean;
```

Importar `IsOptional`, `IsBoolean` de `class-validator` e `ApiPropertyOptional`
de `@nestjs/swagger` se ainda não estiverem importados.

- [ ] **Step 2: DTO do PATCH**

Criar `src/modules/media-library/dto/update-folder.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFolderDto {
  @ApiPropertyOptional({ example: 'Figurinhas' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ description: 'Marca/desmarca como pasta de figurinhas' })
  @IsOptional()
  @IsBoolean()
  isStickerFolder?: boolean;
}
```

- [ ] **Step 3: Métodos no repositório**

Em `src/modules/media-library/media-library.repository.ts`, acrescentar:

```ts
  updateFolder(id: string, data: { name?: string; isStickerFolder?: boolean }) {
    return this.prisma.mediaFolder.update({ where: { id }, data });
  }

  /**
   * Assets de todas as pastas marcadas como figurinha. O filtro por
   * organizationId está no asset E na pasta — a pasta é a fonte da verdade do
   * "isto é figurinha", e o asset é o que o compositor envia.
   */
  findStickerAssets(organizationId: string) {
    return this.prisma.mediaAsset.findMany({
      where: {
        organizationId,
        deletedAt: null,
        mimeType: 'image/webp',
        folder: { isStickerFolder: true, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
```

- [ ] **Step 4: Métodos no service**

Em `src/modules/media-library/media-library.service.ts`, acrescentar depois de
`deleteFolder`:

```ts
  async updateFolder(
    id: string,
    orgId: string,
    dto: { name?: string; isStickerFolder?: boolean },
  ) {
    const folder = await this.repository.findFolderById(id);
    if (!folder || folder.organizationId !== orgId) {
      throw new NotFoundException('Folder not found');
    }
    return this.repository.updateFolder(id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.isStickerFolder !== undefined
        ? { isStickerFolder: dto.isStickerFolder }
        : {}),
    });
  }

  async listStickers(orgId: string) {
    return this.repository.findStickerAssets(orgId);
  }
```

E, no `createFolder`, repassar o flag:

```ts
  async createFolder(orgId: string, userId: string, dto: CreateFolderDto) {
    return this.repository.createFolder({
      name: dto.name.trim(),
      isStickerFolder: dto.isStickerFolder ?? false,
      createdById: userId,
      organization: { connect: { id: orgId } },
    });
  }
```

- [ ] **Step 5: Rotas no controller**

Em `src/modules/media-library/media-library.controller.ts`, acrescentar `Patch`
ao import de `@nestjs/common`, importar `UpdateFolderDto`, e acrescentar:

```ts
  @Patch('folders/:id')
  @ApiOperation({ summary: 'Rename folder / toggle sticker folder' })
  updateFolder(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.service.updateFolder(id, orgId, dto);
  }

  @Get('stickers')
  @ApiOperation({ summary: 'List sticker assets (webp in sticker folders)' })
  listStickers(@CurrentOrg('id') orgId: string) {
    return this.service.listStickers(orgId);
  }
```

> **Atenção à ordem das rotas:** `@Get('stickers')` precisa ficar declarado antes
> de qualquer rota `@Get('assets/:id')` que exista, senão o Nest casa `stickers`
> como parâmetro. Hoje não há colisão — confira ao inserir.

- [ ] **Step 6: Typecheck**

Run: `yarn typecheck`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/modules/media-library
git commit -m "feat(media-library): PATCH de pasta e GET /stickers"
```

---

## Task 4: Destravar `STICKER` no envio

**Files:**
- Modify: `src/modules/messaging/messages/dto/send-message.dto.ts`
- Modify: `src/modules/messaging/messages/messages.service.ts`

- [ ] **Step 1: Adicionar `STICKER` ao DTO**

Em `src/modules/messaging/messages/dto/send-message.dto.ts`, trocar **os dois**
lugares (mexer só num deixa o Swagger mentindo ou a validação frouxa):

```ts
  @ApiProperty({ enum: ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE', 'STICKER'] })
  @IsEnum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'TEMPLATE', 'STICKER'])
  type: string;
```

- [ ] **Step 2: Chamar o guard no `send()`**

Em `src/modules/messaging/messages/messages.service.ts`, importar o guard:

```ts
import { assertStickerAllowed } from './sticker-guard';
```

e chamá-lo logo depois da checagem de `contactChannel` (por volta da linha 117),
**antes** de qualquer escrita no banco:

```ts
    // Figurinha: `content.mediaUrl` é string livre e seria repassada ao
    // provedor sem checagem. Valida antes de persistir a Message.
    if (dto.type === 'STICKER') {
      await assertStickerAllowed(this.prisma, organizationId, dto.content);
    }
```

- [ ] **Step 3: Rodar a suíte da API**

Run: `yarn test`
Expected: PASS — nenhuma regressão.

- [ ] **Step 4: Commit**

```bash
git add src/modules/messaging/messages
git commit -m "feat(messages): aceita envio de STICKER"
```

---

# PARTE B — Web

## Task 5: Serviço e tipos

**Files:**
- Modify: `src/features/media-library/services/media-library.service.ts`

- [ ] **Step 1: Atualizar o tipo e acrescentar os métodos**

Em `src/features/media-library/services/media-library.service.ts`, no
`interface MediaFolder`, acrescentar `isStickerFolder: boolean;`. Depois, dentro
de `mediaLibraryService`, acrescentar:

```ts
  async listStickers(): Promise<MediaAsset[]> {
    const { data } = await api.get('/media-library/stickers');
    return data.data;
  },

  async updateFolder(
    id: string,
    patch: { name?: string; isStickerFolder?: boolean },
  ): Promise<MediaFolder> {
    const { data } = await api.patch(`/media-library/folders/${id}`, patch);
    return data.data;
  },
```

E ajustar `createFolder` para repassar o flag:

```ts
  async createFolder(
    name: string,
    opts?: { isStickerFolder?: boolean },
  ): Promise<MediaFolder> {
    const { data } = await api.post('/media-library/folders', {
      name,
      ...(opts?.isStickerFolder ? { isStickerFolder: true } : {}),
    });
    return data.data;
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/features/media-library/services/media-library.service.ts
git commit -m "feat(media-library): listStickers e updateFolder no client"
```

---

## Task 6: Grid de figurinhas

**Files:**
- Create: `src/features/inbox/components/sticker-grid.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  mediaLibraryService,
  type MediaAsset,
} from '@/features/media-library/services/media-library.service';

interface Props {
  onPick: (asset: MediaAsset) => void;
}

/**
 * Só lista e devolve a escolha — quem envia é o compositor.
 */
export function StickerGrid({ onPick }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['media-library', 'stickers'],
    queryFn: () => mediaLibraryService.listStickers(),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex h-[340px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="flex h-[340px] flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground">
          Nenhuma figurinha ainda
        </p>
        <p className="text-xs text-muted-foreground">
          Crie uma pasta marcada como “figurinhas” na Biblioteca de arquivos e
          suba arquivos .webp nela.
        </p>
      </div>
    );
  }

  return (
    <div className="grid h-[340px] grid-cols-4 gap-2 overflow-y-auto p-3">
      {data.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => onPick(asset)}
          className="flex aspect-square items-center justify-center rounded-lg p-1 hover:bg-muted"
          title={asset.title || asset.filename}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.url}
            alt={asset.title || asset.filename}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/inbox/components/sticker-grid.tsx
git commit -m "feat(inbox): grid de figurinhas da biblioteca"
```

---

## Task 7: Painel com abas

**Files:**
- Create: `src/features/inbox/components/emoji-sticker-popover.tsx`
- Modify: `src/features/inbox/components/chat-input.tsx`

- [ ] **Step 1: Criar o painel com abas**

```tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { StickerGrid } from './sticker-grid';
import type { MediaAsset } from '@/features/media-library/services/media-library.service';

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

interface Props {
  onPickEmoji: (emoji: string) => void;
  onPickSticker: (asset: MediaAsset) => void;
}

type Tab = 'emoji' | 'sticker';

export function EmojiStickerPopover({ onPickEmoji, onPickSticker }: Props) {
  const [tab, setTab] = useState<Tab>('emoji');

  return (
    <div className="w-[352px]">
      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        {(
          [
            ['emoji', 'Emojis'],
            ['sticker', 'Figurinhas'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'flex-1 border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground'
                : 'flex-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'emoji' ? (
        <EmojiPickerPanel onPick={onPickEmoji} />
      ) : (
        <StickerGrid onPick={onPickSticker} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Trocar o painel no `chat-input.tsx`**

Remover o `const EmojiPickerPanel = dynamic(...)` do `chat-input.tsx` (ele agora
vive dentro do `emoji-sticker-popover.tsx`) e importar o popover:

```tsx
import { EmojiStickerPopover } from './emoji-sticker-popover';
import type { MediaAsset } from '@/features/media-library/services/media-library.service';
```

- [ ] **Step 3: Handler de envio da figurinha**

Logo depois de `handlePickEmoji`, acrescentar:

```tsx
/**
 * Figurinha vai direto, sem passar pela bandeja de anexos: é envio de um
 * clique, como no WhatsApp. Diferente do clipe/Ctrl+V, aqui o atendente já
 * escolheu conscientemente o arquivo exato que quer mandar.
 */
const handlePickSticker = useCallback(
  async (asset: MediaAsset) => {
    if (!conversationId) return;
    try {
      await inboxService.sendMessage({
        conversationId,
        type: 'STICKER',
        content: { mediaUrl: asset.url },
      });
    } catch {
      toast.error('Não foi possível enviar a figurinha.');
    }
  },
  [conversationId],
);
```

Importar `inboxService` de `../services/inbox.service` se ainda não estiver
importado no arquivo.

- [ ] **Step 4: Trocar o conteúdo do `PopoverPanel`**

Dentro do `<PopoverPanel>` criado na Fatia 1, trocar

```tsx
<EmojiPickerPanel onPick={handlePickEmoji} />
```

por

```tsx
<EmojiStickerPopover
  onPickEmoji={handlePickEmoji}
  onPickSticker={handlePickSticker}
/>
```

E ajustar o `aria-label` do botão de `"Inserir emoji"` para
`"Emojis e figurinhas"`.

- [ ] **Step 5: Verificar**

Run: `yarn test && npx tsc --noEmit && yarn build`
Expected: 7 testes passando, typecheck limpo, build sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/features/inbox/components/chat-input.tsx src/features/inbox/components/emoji-sticker-popover.tsx
git commit -m "feat(inbox): painel com abas Emojis/Figurinhas"
```

---

## Task 8: Marcar a pasta como "de figurinhas" na Biblioteca

Sem esta task não existe nenhuma forma de marcar uma pasta, e a aba do
compositor fica permanentemente vazia.

**Files:**
- Modify: `src/features/media-library/components/media-library-dialog.tsx`

- [ ] **Step 1: Perguntar ao criar a pasta**

O diálogo usa `window.prompt`/`window.confirm` para operações de pasta. Seguir o
mesmo idioma em vez de introduzir um formulário novo. Substituir `handleNewFolder`:

```tsx
  const handleNewFolder = async () => {
    const name = window.prompt('Nome da nova pasta:')?.trim();
    if (!name) return;
    const isStickerFolder = window.confirm(
      `A pasta "${name}" é uma pasta de figurinhas?\n\n` +
        'Os arquivos .webp dela aparecem na aba "Figurinhas" do compositor.',
    );
    try {
      await mediaLibraryService.createFolder(name, { isStickerFolder });
      await invalidate();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao criar pasta');
    }
  };
```

- [ ] **Step 2: Alternar numa pasta que já existe**

Acrescentar o handler junto dos outros:

```tsx
  const handleToggleSticker = async (folder: MediaFolder) => {
    const next = !folder.isStickerFolder;
    const question = next
      ? `Marcar "${folder.name}" como pasta de figurinhas?`
      : `Desmarcar "${folder.name}" como pasta de figurinhas?`;
    if (!window.confirm(question)) return;
    try {
      await mediaLibraryService.updateFolder(folder.id, {
        isStickerFolder: next,
      });
      await invalidate();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao atualizar pasta');
    }
  };
```

- [ ] **Step 3: Botão para a pasta selecionada**

Na barra de ações onde está o botão "Nova pasta", acrescentar antes dele um botão
que só aparece quando há pasta selecionada:

```tsx
{folderId && (
  <button
    type="button"
    onClick={() => {
      const folder = folders?.find((f) => f.id === folderId);
      if (folder) handleToggleSticker(folder);
    }}
    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
  >
    <Sticker className="h-4 w-4" />
    {folders?.find((f) => f.id === folderId)?.isStickerFolder
      ? 'Não é de figurinhas'
      : 'É de figurinhas'}
  </button>
)}
```

Importar `Sticker` de `lucide-react` e o tipo `MediaFolder` do serviço, se ainda
não estiverem importados.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/features/media-library/components/media-library-dialog.tsx
git commit -m "feat(media-library): marcar pasta como pasta de figurinhas"
```

---

## Task 9: Verificação ponta a ponta

Precisa de uma conversa real num canal WhatsApp ativo.

- [ ] **Step 1:** Na Biblioteca de arquivos, criar uma pasta marcada como
      figurinhas e subir um `.webp` de 512×512 nela.
- [ ] **Step 2:** No inbox, abrir o painel 😀 → aba **Figurinhas** → a figurinha
      aparece no grid.
- [ ] **Step 3:** Clicar nela → sai na conversa e chega como **figurinha** no
      WhatsApp do cliente (não como imagem).
- [ ] **Step 4:** Com a pasta **desmarcada**, reabrir a aba → o grid fica vazio
      com a mensagem de orientação.
- [ ] **Step 5:** Numa conversa com a janela de 24h fechada, o botão 😀 não
      aparece (o compositor inteiro é substituído pelo aviso de template).
- [ ] **Step 6:** *(segurança)* Com o token da organização A, chamar
      `POST /messages` com `type: 'STICKER'` e a `mediaUrl` de um asset da
      organização B → resposta `403`.

---

## Task 10: PRs

- [ ] **Step 1: PR da API**

```bash
git push -u origin feat/sticker-send-api
gh pr create --base feat/conversation-tabs \
  --title "feat(messages): enviar figurinha da Biblioteca" \
  --body "Fatia 2 da spec docs/superpowers/specs/2026-07-27-emoji-sticker-reacao-design.md

- flag isStickerFolder na MediaFolder (+ PATCH de pasta, que não existia)
- GET /media-library/stickers
- STICKER liberado no send-message.dto
- guard novo: content.mediaUrl precisa ser asset da própria organização

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: PR da Web** (só depois da API estar no ar, senão a aba quebra)

```bash
git push -u origin feat/sticker-send-web
gh pr create --base feat/conversation-tabs \
  --title "feat(inbox): aba de figurinhas no compositor" \
  --body "Fatia 2 da spec docs/superpowers/specs/2026-07-27-emoji-sticker-reacao-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
