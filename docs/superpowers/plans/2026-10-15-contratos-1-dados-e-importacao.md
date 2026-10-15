# Contratos (parte 1) — Tabelas e importação do Lovable · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o banco e o MinIO do Sendtur todo o histórico do app de contratos que hoje roda no Lovable (389 contratos, 16 datas bloqueadas, os termos e 450 arquivos), sem perder nada e podendo repetir a importação na virada.

**Architecture:** Três tabelas novas (`contracts`, `contract_blocked_dates`, `contract_settings`) multitenant por `organizationId`, no padrão do resto do schema. Um módulo `contracts` que, nesta parte, só tem a importação: um mapper puro (linha do Lovable → linha do Sendtur), um service idempotente (upsert por `legacyId`) e um controller restrito a OWNER. Um script roda no Mac, lê o backup local e chama a API por HTTP (mesmo padrão de `scripts/backfill-lead-cards.ts`): sem acesso direto ao banco e em DRY-RUN por padrão.

**Tech Stack:** NestJS 11, Prisma 6, Postgres, MinIO (`StorageService`), Jest; script em ts-node.

**Fora do escopo (partes 2–4, planos próprios):** telas de contrato no web, página pública de aceite, PDF, IA de preenchimento, e-mail de comprovante, sincronização com o Google Agenda e a virada (congelar o Lovable e redirecionar os links antigos).

---

## Contexto que o executor precisa saber

- **Origem dos dados:** o Supabase do app é o Supabase interno do Lovable (`rdgxxwdpdsqojjquftan`), e não está na conta do Kleber. O backup completo já foi feito em `~/dev/backups/contratos-lovable-20261015/`:
  - `contracts.json` (389), `blocked_dates.json` (16), `app_settings.json` (1);
  - `files/` (450 arquivos) e `files_index.json`.
  - **Tem CPF, endereço e telefone de clientes. Nunca copie para dentro do repositório nem cole em PR.**
- **Formato de uma linha de `contracts.json`** (nomes em português, do Lovable):
  `id` (uuid), `nome_completo`, `cpf`, `endereco`, `cep`, `email`, `telefone`, `datas_requeridas`, `nome_guia` ("Kleber" | "Rafael"), `vendedor` (texto ou null), `quantidade_dias` (int), `quantidade_pessoas` (int ou null), `valor` (texto, ex. `"2190,00"`), `pix_key`, `hospede_disney`, `comprado`, `pago`, `nf_emitida` (bool), `umbler_chat_url`, `acceptance_token`, `accepted_at`, `client_ip`, `client_user_agent`, `signature_url`, `signed_contract_url`, `payment_receipt_url`, `created_at`.
- **URLs de arquivo** têm a forma `https://rdgxxwdpdsqojjquftan.supabase.co/storage/v1/object/public/contract-documents/<caminho>`, e às vezes o caminho vem com `%20`. O caminho decodificado (`decodeURIComponent`) é exatamente a entrada em `files_index.json` e o arquivo em `files/<caminho>`. Isso já foi conferido: 415 referências, 0 faltando.
- **Chave no MinIO:** `contracts/<organizationId>/<caminho decodificado>`. Guardamos a **chave**, não a URL. Esses arquivos têm dado pessoal e não podem ficar públicos; quem vai servi-los é a parte 2.
- **Base da branch:** o deploy vivo da API é a branch `feat/conversation-tabs` de `klebermdc/chat-bullq-api` (o `main` está atrasado, sem MinIO). Crie `feat/contratos-dados` a partir de `origin/feat/conversation-tabs`, num worktree em `~/dev/api-contratos` (fora do iCloud, porque o iCloud trava tsc e git).
- **Limite de body JSON** é o padrão do Express, 100 KB. Por isso o script manda contratos em lotes de 25 e os arquivos um a um, em multipart.

## File Structure

- Modify: `prisma/schema.prisma`: models `Contract`, `ContractBlockedDate`, `ContractSettings` e as relações em `Organization`.
- Create: `prisma/migrations/20261015180000_contracts/migration.sql`
- Create: `src/modules/contracts/legacy/legacy.types.ts`: tipos das linhas do Lovable.
- Create: `src/modules/contracts/legacy/legacy-contract.mapper.ts`: funções puras de mapeamento.
- Create: `src/modules/contracts/legacy/legacy-contract.mapper.spec.ts`
- Create: `src/modules/contracts/legacy/contracts-import.service.ts`: upserts e gravação no MinIO.
- Create: `src/modules/contracts/legacy/contracts-import.service.spec.ts`
- Create: `src/modules/contracts/legacy/contracts-import.controller.ts`: rotas `contracts/legacy-import/*` (OWNER).
- Create: `src/modules/contracts/legacy/dto/import-batch.dto.ts`
- Create: `src/modules/contracts/contracts.module.ts`
- Modify: `src/app.module.ts`: importar `ContractsModule`.
- Create: `scripts/import-contratos-lovable.ts`

---

### Task 1: Worktree e branch

- [ ] **Step 1: Criar o worktree a partir do main atualizado**

```bash
cd ~/dev/api-visao && git fetch origin
git worktree add -b feat/contratos-dados ~/dev/api-contratos origin/feat/conversation-tabs
cd ~/dev/api-contratos && npm ci && npx prisma generate
```

- [ ] **Step 2: Confirmar a base verde**

Run: `npm run typecheck && npm test -- --silent 2>&1 | tail -5`
Expected: typecheck sem erros; `Tests: ... passed`.

---

### Task 2: Schema e migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261015180000_contracts/migration.sql`

- [ ] **Step 1: Adicionar os models ao fim de `prisma/schema.prisma`**

```prisma
/// Contrato de guiamento (Lightning Lane / guia nos parques). Veio do app
/// "pix-magic-contracts" do Lovable; `legacyId` guarda o uuid de lá para a
/// importação ser repetível (upsert) e para rastrear a origem.
model Contract {
  id             String  @id @default(cuid())
  organizationId String  @map("organization_id")
  legacyId       String? @map("legacy_id")

  fullName       String  @map("full_name")
  cpf            String
  address        String
  cep            String
  email          String
  phone          String
  requestedDates String  @map("requested_dates") @db.Text
  guideName      String  @map("guide_name")
  sellerName     String? @map("seller_name")
  days           Int
  people         Int     @default(1)
  /// Texto como no legado ("2190,00"). Converter para número é decisão da parte 2.
  amount         String
  pixKey         String? @map("pix_key")

  disneyGuest   Boolean @default(false) @map("disney_guest")
  purchased     Boolean @default(false)
  paid          Boolean @default(false)
  invoiceIssued Boolean @default(false) @map("invoice_issued")
  /// Link da conversa no chat antigo (Umbler). Só histórico.
  legacyChatUrl String? @map("legacy_chat_url")

  acceptanceToken String?   @unique @map("acceptance_token")
  acceptedAt      DateTime? @map("accepted_at")
  clientIp        String?   @map("client_ip")
  clientUserAgent String?   @map("client_user_agent") @db.Text

  /// Chaves no MinIO (não URLs): `contracts/<orgId>/...`. Conteúdo pessoal, nunca público.
  signatureKey      String? @map("signature_key")
  signedContractKey String? @map("signed_contract_key")
  paymentReceiptKey String? @map("payment_receipt_key")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, legacyId])
  @@index([organizationId, guideName])
  @@index([organizationId, createdAt])
  @@map("contracts")
}

/// Dia em que o guia está lotado e o formulário não deixa vender.
model ContractBlockedDate {
  id             String   @id @default(cuid())
  organizationId String   @map("organization_id")
  guideName      String   @map("guide_name")
  date           DateTime @db.Date
  reason         String   @default("lotado")
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, guideName, date])
  @@map("contract_blocked_dates")
}

/// Termos do contrato (texto que o cliente aceita), um por organização.
model ContractSettings {
  organizationId String   @id @map("organization_id")
  terms          String   @db.Text
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("contract_settings")
}
```

- [ ] **Step 2: Adicionar as relações dentro de `model Organization`**, logo abaixo da linha `orderAcceptances          OrderAcceptance[]`:

```prisma
  contracts                 Contract[]
  contractBlockedDates      ContractBlockedDate[]
  contractSettings          ContractSettings?
```

- [ ] **Step 3: Validar o schema**

Run: `npx prisma format && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Escrever a migration à mão** em `prisma/migrations/20261015180000_contracts/migration.sql`:

```sql
-- Contratos de guiamento vindos do app do Lovable (pix-magic-contracts).
-- Tabelas novas, sem tocar em nada existente.
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "legacy_id" TEXT,
    "full_name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "requested_dates" TEXT NOT NULL,
    "guide_name" TEXT NOT NULL,
    "seller_name" TEXT,
    "days" INTEGER NOT NULL,
    "people" INTEGER NOT NULL DEFAULT 1,
    "amount" TEXT NOT NULL,
    "pix_key" TEXT,
    "disney_guest" BOOLEAN NOT NULL DEFAULT false,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "invoice_issued" BOOLEAN NOT NULL DEFAULT false,
    "legacy_chat_url" TEXT,
    "acceptance_token" TEXT,
    "accepted_at" TIMESTAMP(3),
    "client_ip" TEXT,
    "client_user_agent" TEXT,
    "signature_key" TEXT,
    "signed_contract_key" TEXT,
    "payment_receipt_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contracts_acceptance_token_key" ON "contracts"("acceptance_token");
CREATE UNIQUE INDEX "contracts_organization_id_legacy_id_key" ON "contracts"("organization_id", "legacy_id");
CREATE INDEX "contracts_organization_id_guide_name_idx" ON "contracts"("organization_id", "guide_name");
CREATE INDEX "contracts_organization_id_created_at_idx" ON "contracts"("organization_id", "created_at");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contract_blocked_dates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "guide_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'lotado',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_blocked_dates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_blocked_dates_organization_id_guide_name_date_key"
  ON "contract_blocked_dates"("organization_id", "guide_name", "date");
ALTER TABLE "contract_blocked_dates" ADD CONSTRAINT "contract_blocked_dates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contract_settings" (
    "organization_id" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_settings_pkey" PRIMARY KEY ("organization_id")
);
ALTER TABLE "contract_settings" ADD CONSTRAINT "contract_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Conferir o nome da tabela de organizações**

Run: `grep -n '@@map("organizations")' prisma/schema.prisma`
Expected: uma linha. Se o nome for outro, corrija as três `REFERENCES` da migration.

- [ ] **Step 6: Commit**

```bash
npx prisma generate
git add prisma/schema.prisma prisma/migrations/20261015180000_contracts
git commit -m "feat(contracts): tabelas de contratos, datas bloqueadas e termos"
```

---

### Task 3: Tipos do legado e mapper puro

**Files:**
- Create: `src/modules/contracts/legacy/legacy.types.ts`
- Create: `src/modules/contracts/legacy/legacy-contract.mapper.ts`
- Test: `src/modules/contracts/legacy/legacy-contract.mapper.spec.ts`

- [ ] **Step 1: Criar os tipos** em `legacy.types.ts`

```ts
/** Linha de `public.contracts` no Supabase do Lovable, como veio no backup. */
export interface LegacyContractRow {
  id: string;
  nome_completo: string;
  cpf: string;
  endereco: string;
  cep: string;
  email: string;
  telefone: string;
  datas_requeridas: string;
  nome_guia: string;
  vendedor: string | null;
  quantidade_dias: number;
  quantidade_pessoas: number | null;
  valor: string;
  pix_key: string | null;
  hospede_disney: boolean;
  comprado: boolean;
  pago: boolean;
  nf_emitida: boolean;
  umbler_chat_url: string | null;
  acceptance_token: string | null;
  accepted_at: string | null;
  client_ip: string | null;
  client_user_agent: string | null;
  signature_url: string | null;
  signed_contract_url: string | null;
  payment_receipt_url: string | null;
  created_at: string;
}

/** Linha de `public.blocked_dates`. */
export interface LegacyBlockedDateRow {
  guide_name: string;
  blocked_date: string; // "YYYY-MM-DD"
  reason: string;
  created_at: string;
}

export const LEGACY_BUCKET_MARKER = '/contract-documents/';
```

- [ ] **Step 2: Escrever o teste que falha** em `legacy-contract.mapper.spec.ts`

```ts
import {
  legacyPathFromUrl,
  storageKeyFor,
  mapLegacyContract,
  mapLegacyBlockedDate,
} from './legacy-contract.mapper';
import type { LegacyContractRow } from './legacy.types';

const BASE =
  'https://rdgxxwdpdsqojjquftan.supabase.co/storage/v1/object/public/contract-documents/';

function row(overrides: Partial<LegacyContractRow> = {}): LegacyContractRow {
  return {
    id: '77fc45d1-be09-4769-85f0-01c18e4a19fe',
    nome_completo: 'Cliente Teste',
    cpf: '000.000.000-00',
    endereco: 'Rua A, 1',
    cep: '00000-000',
    email: 'cliente@example.com',
    telefone: '(11) 90000-0000',
    datas_requeridas: 'Datas a definir',
    nome_guia: 'Kleber',
    vendedor: 'Marcella',
    quantidade_dias: 2,
    quantidade_pessoas: 4,
    valor: '2190,00',
    pix_key: '55513365000101',
    hospede_disney: false,
    comprado: true,
    pago: true,
    nf_emitida: false,
    umbler_chat_url: null,
    acceptance_token: '934d56314e0144f98b5788ba',
    accepted_at: '2026-10-15T19:30:00+00:00',
    client_ip: '1.2.3.4',
    client_user_agent: 'Mozilla',
    signature_url: `${BASE}signatures/abc.png`,
    signed_contract_url: null,
    payment_receipt_url: `${BASE}receipts/x_1_Comprovante%20Fast.jpeg`,
    created_at: '2026-10-15T19:01:28.127626+00:00',
    ...overrides,
  };
}

describe('legacyPathFromUrl', () => {
  it('extrai o caminho do bucket e decodifica %20', () => {
    expect(legacyPathFromUrl(`${BASE}receipts/a_1_Compr%20orlando.png`)).toBe(
      'receipts/a_1_Compr orlando.png',
    );
  });

  it('ignora query string', () => {
    expect(legacyPathFromUrl(`${BASE}signatures/a.png?t=1`)).toBe('signatures/a.png');
  });

  it('devolve null para vazio e para URL de fora do bucket', () => {
    expect(legacyPathFromUrl(null)).toBeNull();
    expect(legacyPathFromUrl('https://example.com/x.png')).toBeNull();
  });
});

describe('storageKeyFor', () => {
  it('prefixa com contracts/<org>/', () => {
    expect(storageKeyFor('org1', 'signatures/a.png')).toBe('contracts/org1/signatures/a.png');
  });

  it('recusa caminho com ..', () => {
    expect(() => storageKeyFor('org1', '../x')).toThrow();
  });
});

describe('mapLegacyContract', () => {
  it('mapeia todos os campos e preserva datas e token', () => {
    const out = mapLegacyContract('org1', row());

    expect(out).toMatchObject({
      organizationId: 'org1',
      legacyId: '77fc45d1-be09-4769-85f0-01c18e4a19fe',
      fullName: 'Cliente Teste',
      guideName: 'Kleber',
      sellerName: 'Marcella',
      days: 2,
      people: 4,
      amount: '2190,00',
      purchased: true,
      paid: true,
      invoiceIssued: false,
      acceptanceToken: '934d56314e0144f98b5788ba',
      signatureKey: 'contracts/org1/signatures/abc.png',
      signedContractKey: null,
      paymentReceiptKey: 'contracts/org1/receipts/x_1_Comprovante Fast.jpeg',
    });
    expect(out.createdAt.toISOString()).toBe('2026-10-15T19:01:28.127Z');
    expect(out.acceptedAt?.toISOString()).toBe('2026-10-15T19:30:00.000Z');
  });

  it('pessoas nulo vira 1', () => {
    expect(mapLegacyContract('org1', row({ quantidade_pessoas: null })).people).toBe(1);
  });

  it('falha com mensagem clara quando falta campo obrigatório', () => {
    expect(() => mapLegacyContract('org1', row({ nome_completo: '' }))).toThrow(
      /77fc45d1.*nome_completo/,
    );
  });
});

describe('mapLegacyBlockedDate', () => {
  it('converte a data para meia-noite UTC', () => {
    const out = mapLegacyBlockedDate('org1', {
      guide_name: 'Kleber',
      blocked_date: '2026-02-16',
      reason: 'lotado',
      created_at: '2026-02-14T02:29:14.375671+00:00',
    });
    expect(out.date.toISOString()).toBe('2026-02-16T00:00:00.000Z');
    expect(out.guideName).toBe('Kleber');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- src/modules/contracts/legacy/legacy-contract.mapper.spec.ts`
Expected: FAIL com `Cannot find module './legacy-contract.mapper'`.

- [ ] **Step 4: Implementar** `legacy-contract.mapper.ts`

```ts
import type { Prisma } from '@prisma/client';
import {
  LEGACY_BUCKET_MARKER,
  type LegacyBlockedDateRow,
  type LegacyContractRow,
} from './legacy.types';

const REQUIRED_FIELDS: (keyof LegacyContractRow)[] = [
  'id',
  'nome_completo',
  'cpf',
  'nome_guia',
  'valor',
  'created_at',
];

/** Caminho do arquivo dentro do bucket `contract-documents`, decodificado. */
export function legacyPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(LEGACY_BUCKET_MARKER);
  if (at < 0) return null;
  const raw = url.slice(at + LEGACY_BUCKET_MARKER.length).split('?')[0];
  return raw ? decodeURIComponent(raw) : null;
}

export function storageKeyFor(organizationId: string, legacyPath: string): string {
  if (legacyPath.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Caminho de arquivo inválido: ${legacyPath}`);
  }
  return `contracts/${organizationId}/${legacyPath}`;
}

function keyFromUrl(organizationId: string, url: string | null): string | null {
  const path = legacyPathFromUrl(url);
  return path ? storageKeyFor(organizationId, path) : null;
}

export function mapLegacyContract(
  organizationId: string,
  row: LegacyContractRow,
): Prisma.ContractUncheckedCreateInput & { createdAt: Date; acceptedAt: Date | null } {
  const missing = REQUIRED_FIELDS.filter((f) => row[f] === null || row[f] === undefined || row[f] === '');
  if (missing.length) {
    throw new Error(`Contrato ${row.id ?? '(sem id)'} sem ${missing.join(', ')}`);
  }
  return {
    organizationId,
    legacyId: row.id,
    fullName: row.nome_completo,
    cpf: row.cpf,
    address: row.endereco ?? '',
    cep: row.cep ?? '',
    email: row.email ?? '',
    phone: row.telefone ?? '',
    requestedDates: row.datas_requeridas ?? '',
    guideName: row.nome_guia,
    sellerName: row.vendedor || null,
    days: row.quantidade_dias ?? 0,
    people: row.quantidade_pessoas ?? 1,
    amount: row.valor,
    pixKey: row.pix_key || null,
    disneyGuest: !!row.hospede_disney,
    purchased: !!row.comprado,
    paid: !!row.pago,
    invoiceIssued: !!row.nf_emitida,
    legacyChatUrl: row.umbler_chat_url || null,
    acceptanceToken: row.acceptance_token || null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
    clientIp: row.client_ip || null,
    clientUserAgent: row.client_user_agent || null,
    signatureKey: keyFromUrl(organizationId, row.signature_url),
    signedContractKey: keyFromUrl(organizationId, row.signed_contract_url),
    paymentReceiptKey: keyFromUrl(organizationId, row.payment_receipt_url),
    createdAt: new Date(row.created_at),
  };
}

export function mapLegacyBlockedDate(
  organizationId: string,
  row: LegacyBlockedDateRow,
): Prisma.ContractBlockedDateUncheckedCreateInput & { date: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.blocked_date)) {
    throw new Error(`Data bloqueada inválida: ${row.blocked_date}`);
  }
  return {
    organizationId,
    guideName: row.guide_name,
    date: new Date(`${row.blocked_date}T00:00:00.000Z`),
    reason: row.reason || 'lotado',
    createdAt: new Date(row.created_at),
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- src/modules/contracts/legacy/legacy-contract.mapper.spec.ts`
Expected: PASS (9 testes).

- [ ] **Step 6: Commit**

```bash
git add src/modules/contracts/legacy/legacy.types.ts src/modules/contracts/legacy/legacy-contract.mapper.ts src/modules/contracts/legacy/legacy-contract.mapper.spec.ts
git commit -m "feat(contracts): mapper das linhas do Lovable para o Sendtur"
```

---

### Task 4: Service de importação (idempotente)

**Files:**
- Create: `src/modules/contracts/legacy/contracts-import.service.ts`
- Test: `src/modules/contracts/legacy/contracts-import.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { ContractsImportService } from './contracts-import.service';

function make(opts: { existingStat?: { size: number } | null } = {}) {
  const prisma = {
    contract: { upsert: jest.fn().mockResolvedValue({}) },
    contractBlockedDate: { upsert: jest.fn().mockResolvedValue({}) },
    contractSettings: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
  const storage = {
    stat: jest.fn().mockResolvedValue(opts.existingStat ?? null),
    put: jest.fn().mockResolvedValue(undefined),
  } as any;
  return { service: new ContractsImportService(prisma, storage), prisma, storage };
}

const ROW = {
  id: 'legacy-1',
  nome_completo: 'Cliente',
  cpf: '1',
  endereco: 'R',
  cep: 'C',
  email: 'e@x.com',
  telefone: 'T',
  datas_requeridas: 'D',
  nome_guia: 'Kleber',
  vendedor: null,
  quantidade_dias: 1,
  quantidade_pessoas: 2,
  valor: '100,00',
  pix_key: null,
  hospede_disney: false,
  comprado: false,
  pago: false,
  nf_emitida: false,
  umbler_chat_url: null,
  acceptance_token: 'tok',
  accepted_at: null,
  client_ip: null,
  client_user_agent: null,
  signature_url: null,
  signed_contract_url: null,
  payment_receipt_url: null,
  created_at: '2026-01-03T19:50:57.20986+00:00',
};

describe('ContractsImportService', () => {
  it('faz upsert de contrato pela chave (org, legacyId)', async () => {
    const { service, prisma } = make();

    const result = await service.importContracts('org1', [ROW]);

    expect(result).toEqual({ imported: 1 });
    const arg = prisma.contract.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      organizationId_legacyId: { organizationId: 'org1', legacyId: 'legacy-1' },
    });
    expect(arg.create.fullName).toBe('Cliente');
    expect(arg.update.fullName).toBe('Cliente');
    expect(arg.update.organizationId).toBeUndefined();
  });

  it('rejeita o lote inteiro se uma linha é inválida', async () => {
    const { service, prisma } = make();

    await expect(
      service.importContracts('org1', [ROW, { ...ROW, id: 'legacy-2', cpf: '' }]),
    ).rejects.toThrow(/legacy-2/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('datas bloqueadas: upsert por (org, guia, data)', async () => {
    const { service, prisma } = make();

    await service.importBlockedDates('org1', [
      { guide_name: 'Rafael', blocked_date: '2026-03-01', reason: 'lotado', created_at: '2026-02-01T00:00:00Z' },
    ]);

    expect(prisma.contractBlockedDate.upsert.mock.calls[0][0].where).toEqual({
      organizationId_guideName_date: {
        organizationId: 'org1',
        guideName: 'Rafael',
        date: new Date('2026-03-01T00:00:00.000Z'),
      },
    });
  });

  it('termos: upsert por organização', async () => {
    const { service, prisma } = make();

    await service.importSettings('org1', 'Termos X');

    expect(prisma.contractSettings.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      create: { organizationId: 'org1', terms: 'Termos X' },
      update: { terms: 'Termos X' },
    });
  });

  it('arquivo novo é gravado com a chave contracts/<org>/<caminho>', async () => {
    const { service, storage } = make();

    const r = await service.importFile('org1', 'receipts/a b.pdf', Buffer.from('pdf'));

    expect(r).toEqual({ key: 'contracts/org1/receipts/a b.pdf', status: 'stored' });
    expect(storage.put).toHaveBeenCalledWith('contracts/org1/receipts/a b.pdf', Buffer.from('pdf'), 'application/pdf');
  });

  it('arquivo já existente com o mesmo tamanho não é regravado', async () => {
    const { service, storage } = make({ existingStat: { size: 3 } });

    const r = await service.importFile('org1', 'signatures/a.png', Buffer.from('png'));

    expect(r.status).toBe('exists');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('recusa caminho com ..', async () => {
    const { service } = make();
    await expect(service.importFile('org1', '../etc/passwd', Buffer.from('x'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/modules/contracts/legacy/contracts-import.service.spec.ts`
Expected: FAIL com `Cannot find module './contracts-import.service'`.

- [ ] **Step 3: Implementar** `contracts-import.service.ts`

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { mapLegacyBlockedDate, mapLegacyContract, storageKeyFor } from './legacy-contract.mapper';
import type { LegacyBlockedDateRow, LegacyContractRow } from './legacy.types';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
};

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Importa o histórico do app de contratos do Lovable. Tudo é upsert pela
 * origem (`legacyId`, (guia, data), organização), então rodar de novo na
 * virada só atualiza o que mudou e nunca duplica.
 */
@Injectable()
export class ContractsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async importContracts(organizationId: string, rows: LegacyContractRow[]) {
    let mapped: ReturnType<typeof mapLegacyContract>[];
    try {
      mapped = rows.map((r) => mapLegacyContract(organizationId, r));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    await this.prisma.$transaction(
      mapped.map((data) => {
        const { organizationId: _org, legacyId, ...update } = data;
        return this.prisma.contract.upsert({
          where: { organizationId_legacyId: { organizationId, legacyId: legacyId as string } },
          create: data,
          update,
        });
      }),
    );
    return { imported: mapped.length };
  }

  async importBlockedDates(organizationId: string, rows: LegacyBlockedDateRow[]) {
    let mapped: ReturnType<typeof mapLegacyBlockedDate>[];
    try {
      mapped = rows.map((r) => mapLegacyBlockedDate(organizationId, r));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    await this.prisma.$transaction(
      mapped.map((data) =>
        this.prisma.contractBlockedDate.upsert({
          where: {
            organizationId_guideName_date: {
              organizationId,
              guideName: data.guideName,
              date: data.date,
            },
          },
          create: data,
          update: { reason: data.reason },
        }),
      ),
    );
    return { imported: mapped.length };
  }

  async importSettings(organizationId: string, terms: string) {
    if (!terms?.trim()) throw new BadRequestException('Termos vazios');
    await this.prisma.contractSettings.upsert({
      where: { organizationId },
      create: { organizationId, terms },
      update: { terms },
    });
    return { imported: 1 };
  }

  async importFile(organizationId: string, legacyPath: string, buffer: Buffer) {
    let key: string;
    try {
      key = storageKeyFor(organizationId, legacyPath);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const existing = await this.storage.stat(key);
    if (existing && existing.size === buffer.byteLength) {
      return { key, status: 'exists' as const };
    }
    await this.storage.put(key, buffer, contentTypeFor(legacyPath));
    return { key, status: 'stored' as const };
  }

  async status(organizationId: string) {
    const [contracts, blockedDates, settings, withFiles] = await Promise.all([
      this.prisma.contract.count({ where: { organizationId } }),
      this.prisma.contractBlockedDate.count({ where: { organizationId } }),
      this.prisma.contractSettings.count({ where: { organizationId } }),
      this.prisma.contract.count({
        where: {
          organizationId,
          OR: [
            { signatureKey: { not: null } },
            { signedContractKey: { not: null } },
            { paymentReceiptKey: { not: null } },
          ],
        },
      }),
    ]);
    return { contracts, blockedDates, settings, contractsWithFiles: withFiles };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/modules/contracts/legacy/contracts-import.service.spec.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/contracts/legacy/contracts-import.service.ts src/modules/contracts/legacy/contracts-import.service.spec.ts
git commit -m "feat(contracts): importação idempotente do histórico do Lovable"
```

---

### Task 5: Controller restrito, DTO e módulo

**Files:**
- Create: `src/modules/contracts/legacy/dto/import-batch.dto.ts`
- Create: `src/modules/contracts/legacy/contracts-import.controller.ts`
- Create: `src/modules/contracts/contracts.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: DTOs** em `dto/import-batch.dto.ts`. Os campos de cada linha são validados pelo mapper; aqui só o envelope é validado.

```ts
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { LegacyBlockedDateRow, LegacyContractRow } from '../legacy.types';

export const IMPORT_BATCH_MAX = 50;

export class ImportContractsDto {
  @IsArray()
  @ArrayMaxSize(IMPORT_BATCH_MAX)
  rows!: LegacyContractRow[];
}

export class ImportBlockedDatesDto {
  @IsArray()
  @ArrayMaxSize(IMPORT_BATCH_MAX)
  rows!: LegacyBlockedDateRow[];
}

export class ImportSettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  terms!: string;
}

export class ImportFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  path!: string;
}
```

- [ ] **Step 2: Controller** em `contracts-import.controller.ts`

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { ContractsImportService } from './contracts-import.service';
import {
  ImportBlockedDatesDto,
  ImportContractsDto,
  ImportFileDto,
  ImportSettingsDto,
} from './dto/import-batch.dto';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Importação única (e repetível na virada) do app de contratos do Lovable. Só o dono. */
@ApiTags('Contracts — legacy import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER)
@Controller('contracts/legacy-import')
export class ContractsImportController {
  constructor(private readonly service: ContractsImportService) {}

  @Post('contracts')
  @ApiOperation({ summary: 'Upsert de um lote de contratos do Lovable' })
  contracts(@CurrentOrg('id') orgId: string, @Body() dto: ImportContractsDto) {
    return this.service.importContracts(orgId, dto.rows);
  }

  @Post('blocked-dates')
  @ApiOperation({ summary: 'Upsert de datas bloqueadas do Lovable' })
  blockedDates(@CurrentOrg('id') orgId: string, @Body() dto: ImportBlockedDatesDto) {
    return this.service.importBlockedDates(orgId, dto.rows);
  }

  @Post('settings')
  @ApiOperation({ summary: 'Grava os termos do contrato' })
  settings(@CurrentOrg('id') orgId: string, @Body() dto: ImportSettingsDto) {
    return this.service.importSettings(orgId, dto.terms);
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  @ApiOperation({ summary: 'Sobe um arquivo do bucket contract-documents' })
  file(
    @CurrentOrg('id') orgId: string,
    @Body() dto: ImportFileDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    return this.service.importFile(orgId, dto.path, file.buffer);
  }

  @Get('status')
  @ApiOperation({ summary: 'Contagens para conferir a importação' })
  status(@CurrentOrg('id') orgId: string) {
    return this.service.status(orgId);
  }
}
```

- [ ] **Step 3: Conferir se o `StorageModule` é global**

Run: `grep -n "@Global\|exports" src/modules/storage/storage.module.ts`
Expected: se aparecer `@Global()`, o módulo abaixo não precisa importá-lo. Se não aparecer, mantenha `imports: [StorageModule]`.

- [ ] **Step 4: Módulo** em `contracts.module.ts`

```ts
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ContractsImportController } from './legacy/contracts-import.controller';
import { ContractsImportService } from './legacy/contracts-import.service';

@Module({
  imports: [StorageModule],
  controllers: [ContractsImportController],
  providers: [ContractsImportService],
})
export class ContractsModule {}
```

- [ ] **Step 5: Registrar em `src/app.module.ts`.** Adicione o import ao lado de `QuickRepliesModule` e inclua `ContractsModule` na lista `imports`:

```ts
import { ContractsModule } from './modules/contracts/contracts.module';
```

- [ ] **Step 6: Typecheck e testes**

Run: `npm run typecheck && npm test -- src/modules/contracts`
Expected: typecheck sem erros; 16 testes passando.

- [ ] **Step 7: Commit**

```bash
git add src/modules/contracts src/app.module.ts
git commit -m "feat(contracts): rotas de importação do legado (só OWNER)"
```

---

### Task 6: Script de importação (roda no Mac)

**Files:**
- Create: `scripts/import-contratos-lovable.ts`

- [ ] **Step 1: Escrever o script**

```ts
export {}; // isola o escopo do módulo

/**
 * Importa o backup do app de contratos do Lovable para o Sendtur, por HTTP.
 * Lê a pasta gerada pelo backup (contracts.json, blocked_dates.json,
 * app_settings.json, files/ e files_index.json).
 *
 * Idempotente: tudo é upsert. Rodar de novo na virada só traz o que mudou.
 * Os arquivos sobem antes dos contratos, para nenhum contrato apontar para
 * chave inexistente.
 *
 *   BACKUP_DIR=~/dev/backups/contratos-lovable-20261015 \
 *   API_URL=https://sendtur.com.br/api/v1 EMAIL=... PASSWORD=... \
 *     npx ts-node scripts/import-contratos-lovable.ts
 *
 * DRY-RUN por padrão (só confere o backup e mostra contagens). Para gravar: APPLY=1.
 */
import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const BATCH = 25;

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
}

function legacyPath(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf('/contract-documents/');
  return at < 0 ? null : decodeURIComponent(url.slice(at + 20).split('?')[0]);
}

async function login(apiUrl: string) {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  if (!email || !password) throw new Error('Faça login: EMAIL=... PASSWORD=...');
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`login → ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const token = j.accessToken || j?.data?.accessToken;
  const orgId =
    (process.env.ORG_ID || '').trim() || j.organizations?.[0]?.id || j?.data?.organizations?.[0]?.id;
  if (!token || !orgId) throw new Error('login sem token/org');
  return { Authorization: `Bearer ${token}`, 'x-organization-id': orgId };
}

async function call(apiUrl: string, headers: Record<string, string>, path: string, init: RequestInit) {
  const res = await fetch(`${apiUrl}/contracts/legacy-import/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const dir = (process.env.BACKUP_DIR || '').replace(/^~/, process.env.HOME || '');
  const apiUrl = (process.env.API_URL || '').replace(/\/$/, '');
  if (!dir || !existsSync(join(dir, 'contracts.json'))) throw new Error('BACKUP_DIR inválido');
  if (!apiUrl) throw new Error('Falta API_URL');

  const contracts = readJson<any[]>(dir, 'contracts.json');
  const blocked = readJson<any[]>(dir, 'blocked_dates.json');
  const settings = readJson<any[]>(dir, 'app_settings.json');
  const files = readJson<string[]>(dir, 'files_index.json');

  // Conferência local: todo arquivo citado por contrato tem que estar no backup.
  const index = new Set(files);
  const referenced = contracts.flatMap((c) =>
    [c.signature_url, c.signed_contract_url, c.payment_receipt_url].map(legacyPath).filter(Boolean),
  ) as string[];
  const missing = referenced.filter((p) => !index.has(p) || !existsSync(join(dir, 'files', p)));
  console.log(
    `Backup: ${contracts.length} contratos, ${blocked.length} datas, ${settings.length} termos, ` +
      `${files.length} arquivos (${referenced.length} citados, ${missing.length} faltando).`,
  );
  if (missing.length) throw new Error(`Arquivos faltando: ${missing.slice(0, 5).join(', ')}`);
  if (!APPLY) {
    console.log('DRY-RUN: nada gravado. Rode com APPLY=1 para importar.');
    return;
  }

  const headers = await login(apiUrl);

  let stored = 0;
  let existed = 0;
  for (const [i, p] of files.entries()) {
    const form = new FormData();
    form.append('path', p);
    form.append('file', new Blob([readFileSync(join(dir, 'files', p))]), basename(p));
    const r = await call(apiUrl, headers, 'files', { method: 'POST', body: form });
    r.status === 'stored' ? stored++ : existed++;
    if ((i + 1) % 50 === 0) console.log(`  arquivos ${i + 1}/${files.length}`);
  }
  console.log(`Arquivos: ${stored} gravados, ${existed} já existiam.`);

  const json = { 'Content-Type': 'application/json' };
  for (let i = 0; i < contracts.length; i += BATCH) {
    await call(apiUrl, headers, 'contracts', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ rows: contracts.slice(i, i + BATCH) }),
    });
  }
  await call(apiUrl, headers, 'blocked-dates', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ rows: blocked }),
  });
  if (settings[0]?.contract_terms) {
    await call(apiUrl, headers, 'settings', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ terms: settings[0].contract_terms }),
    });
  }

  const status = await call(apiUrl, headers, 'status', { method: 'GET' });
  console.log('Sendtur agora:', status);
  const withFiles = contracts.filter(
    (c) => c.signature_url || c.signed_contract_url || c.payment_receipt_url,
  ).length;
  const ok =
    status.contracts === contracts.length &&
    status.blockedDates === blocked.length &&
    status.contractsWithFiles === withFiles;
  console.log(ok ? '✅ Contagens batem com o backup.' : '❌ Contagens NÃO batem — investigar.');
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar em DRY-RUN contra o backup**

Run: `BACKUP_DIR=~/dev/backups/contratos-lovable-20261015 API_URL=http://localhost npx ts-node scripts/import-contratos-lovable.ts`
Expected: `Backup: 389 contratos, 16 datas, 1 termos, 450 arquivos (415 citados, 0 faltando).` seguido de `DRY-RUN: nada gravado.`

- [ ] **Step 3: Commit**

```bash
git add scripts/import-contratos-lovable.ts
git commit -m "feat(contracts): script de importação do backup do Lovable"
```

---

### Task 7: Revisão, PR e importação em produção

- [ ] **Step 1: Suite completa e typecheck**

Run: `npm run typecheck && npm test -- --silent 2>&1 | tail -5`
Expected: sem erros de tipo; todos os testes passando.

- [ ] **Step 2: Revisão.** Use o agente `ecc:code-reviewer` e também o `ecc:security-reviewer`, porque há dado pessoal e um endpoint de upload. Corrija o que for CRITICAL ou HIGH.

- [ ] **Step 3: Abrir o PR** em `klebermdc/chat-bullq-api` com base `feat/conversation-tabs`. Push com `-u`. Descreva as tabelas novas, que nada existente muda e o passo a passo de importação abaixo. **Não cole dados do backup.**

- [ ] **Step 4: Depois que o Kleber mesclar e fizer o deploy**, conferir que a migration rodou:

Run (na VPS): `docker exec chat-ofp-postgres-1 psql -U postgres -d chat -c '\dt contract*'`
Expected: `contracts`, `contract_blocked_dates`, `contract_settings`.
(Se o usuário ou o nome do banco forem outros, confira na memória `vps-acesso`.)

- [ ] **Step 5: Importar de verdade** com o login do dono da organização OFP:

Run: `APPLY=1 BACKUP_DIR=~/dev/backups/contratos-lovable-20261015 API_URL=https://sendtur.com.br/api/v1 EMAIL=... PASSWORD=... npx ts-node scripts/import-contratos-lovable.ts`
Expected: `Arquivos: 450 gravados, 0 já existiam.` e `✅ Contagens batem com o backup.`

- [ ] **Step 6: Rodar de novo para provar que é idempotente**

Expected: `Arquivos: 0 gravados, 450 já existiam.` e `✅ Contagens batem com o backup.` (as mesmas contagens, sem duplicar).
