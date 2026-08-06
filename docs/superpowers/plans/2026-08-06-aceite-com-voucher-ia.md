# Aceite com Voucher lido por IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o atendente anexe os PDFs de voucher dentro do modal do Aceite de Entrega, tenha os itens preenchidos por IA, e mande voucher + link de aceite num clique.

**Architecture:** Estende o módulo `acceptances` (já LIVE) com leitura de PDF: `pdfjs-dist` extrai a camada de texto, um extrator grounded temp-0 (clone do `OrderExtractorService`) devolve os itens. O upload reusa `POST messages/uploads/media`, que já aceita `application/pdf`. Migration aditiva acrescenta `vouchers` e `orderRef` ao `OrderAcceptance`. Nada é assíncrono: o atendente está olhando o modal.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest (API, CommonJS) · Next 16 + React + Vitest (Web) · `pdfjs-dist` (nova dep) · LLM via `LlmService` (`SAKANA_SIMPLE_MODEL`, temp 0) · Playwright/Chromium (já presente).

**Spec:** [../specs/2026-08-06-aceite-com-voucher-ia-design.md](../specs/2026-08-06-aceite-com-voucher-ia-design.md)

---

## Contexto que o implementador precisa saber

Coisas deste repo que não são óbvias e já derrubaram produção antes:

- **A branch viva de deploy é `fork/feat/conversation-tabs`**, não `main`. Os checkouts locais podem estar em outra branch e sujos — o Task 0 resolve isso. Sempre `git fetch fork` antes de afirmar que algo "não existe".
- **`ResponseInterceptor` global embrulha toda resposta em `{data, meta}`**, inclusive rotas `public/*`. O client axios do web já desempacota; código que usa `fetch` cru precisa desempacotar à mão.
- **Não existe `APP_GUARD` global.** Auth é por-controller (`@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)`).
- **`StorageModule` e `RealtimeModule` são `@Global`** — não precisam ser importados no módulo.
- **`tsconfig` usa `"module": "commonjs"`.** `pdfjs-dist` é ESM puro. Um `await import(...)` escrito direto seria transpilado para `require()` pelo TypeScript e quebraria em runtime. O Task 1 resolve isso com uma ponte explícita.
- **Parâmetro opcional de construtor sem `@Optional()` derruba o boot do Nest** em crashloop, e nem os ~1300 testes pegam. Todo provider novo deste plano tem dependências obrigatórias — não introduza opcional.
- **Estilo:** imutabilidade (nunca mutar objeto recebido), arquivos pequenos e focados, erro nunca engolido em silêncio.

---

## Estrutura de arquivos

**API (`chat-bullq-api`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/acceptances/pdf-text.util.ts` | **Criar.** Buffer de PDF → texto. Só isso. |
| `src/modules/acceptances/pdf-text.util.spec.ts` | **Criar.** Testes do acima. |
| `src/modules/acceptances/voucher.prompts.ts` | **Criar.** O system prompt do extrator, isolado. |
| `src/modules/acceptances/voucher-extractor.service.ts` | **Criar.** Texto → `{ items, orderRef }` via LLM temp 0. |
| `src/modules/acceptances/voucher-extractor.service.spec.ts` | **Criar.** Testes do acima (LLM mockado). |
| `src/modules/acceptances/storage-key.util.ts` | **Criar.** URL pública de upload → chave do storage. |
| `src/modules/acceptances/storage-key.util.spec.ts` | **Criar.** Testes do acima. |
| `src/modules/acceptances/acceptances.types.ts` | **Modificar.** `ref` no item, tipos `VoucherRef`/`ExtractedVoucher`, view pública. |
| `src/modules/acceptances/acceptances.service.ts` | **Modificar.** `extractVoucher`, hash dos vouchers, persistir `vouchers`/`orderRef`, expor na view. |
| `src/modules/acceptances/acceptances.controller.ts` | **Modificar.** `POST acceptances/extract-voucher`. |
| `src/modules/acceptances/dto/extract-voucher.dto.ts` | **Criar.** Validação do body. |
| `src/modules/acceptances/dto/create-acceptance.dto.ts` | **Modificar.** `ref` no item; `vouchers` e `orderRef` no `OrderSentDto`. |
| `src/modules/acceptances/acceptance-pdf.service.ts` | **Modificar.** Comprovante lista vouchers com SHA-256. |
| `src/modules/acceptances/acceptances.module.ts` | **Modificar.** Registrar o extrator; importar `LlmModule`. |
| `src/modules/pipelines/pipelines.service.ts` | **Modificar.** Enviar os PDFs antes do link; relatório de falhas. |
| `prisma/schema.prisma` + migration | **Modificar.** `vouchers Json?`, `orderRef String?`. |

**Web (`chat-bullq-web`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/features/acceptances/voucher-merge.ts` | **Criar.** Dedup/mescla de itens. Função pura, sem React. |
| `src/features/acceptances/voucher-merge.test.ts` | **Criar.** Testes do acima. |
| `src/features/acceptances/types.ts` | **Modificar.** `ref`, `VoucherRef`, `orderRef`. |
| `src/features/acceptances/services/acceptances.service.ts` | **Modificar.** `extractVoucher`. |
| `src/features/pipelines/services/pipelines.service.ts` | **Modificar.** `markOrderSent` aceita `vouchers`/`orderRef`. |
| `src/features/acceptances/components/voucher-drop-zone.tsx` | **Criar.** Área de anexo + chips de status. Só UI. |
| `src/features/acceptances/components/acceptance-dialog.tsx` | **Modificar.** Plugar a drop zone, mesclar itens, relatar envio. |
| `src/app/aceite/[token]/page.tsx` | **Modificar.** Bloco de vouchers + `orderRef`. |

O motivo de `voucher-merge.ts` e `voucher-drop-zone.tsx` serem arquivos separados: o modal já tem ~300 linhas. Enfiar upload, extração, mescla e relatório dentro dele o levaria a 600+, e a lógica de mescla ficaria impossível de testar sem montar componente.

---

## Task 0: Preparar as branches

**Files:** nenhum (setup).

- [ ] **Step 1: Criar a branch da API a partir da branch viva**

Os checkouts locais podem estar em branch antiga e com arquivos staged de outro trabalho. Não commite nada neles.

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/chat-bullq-api"
git fetch fork
git worktree add ../.wt-voucher-ia-api -b feat/aceite-voucher-ia fork/feat/conversation-tabs
cd ../.wt-voucher-ia-api
npm install
```

Esperado: worktree criado, `npm install` conclui sem erro.

- [ ] **Step 2: Criar a branch do Web**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/chat-bullq-web"
git fetch fork
git worktree add ../.wt-voucher-ia-web -b feat/aceite-voucher-ia fork/feat/conversation-tabs
cd ../.wt-voucher-ia-web
npm install
```

Esperado: worktree criado, `npm install` conclui sem erro.

- [ ] **Step 3: Confirmar que a suíte da API está verde ANTES de mexer**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/.wt-voucher-ia-api"
npm test 2>&1 | tail -20
```

Esperado: todos os testes passando. Se já houver teste vermelho na base, **pare e reporte** — não comece por cima de uma base quebrada.

- [ ] **Step 4: Copiar o spec pra dentro do repo da API**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP"
cp docs/superpowers/specs/2026-08-06-aceite-com-voucher-ia-design.md .wt-voucher-ia-api/docs/superpowers/specs/
cp docs/superpowers/plans/2026-08-06-aceite-com-voucher-ia.md .wt-voucher-ia-api/docs/superpowers/plans/
cd .wt-voucher-ia-api
git add docs/superpowers
git commit -m "docs: spec e plano do aceite com voucher lido por IA"
```

---

## Task 1: Extrair texto de PDF

**Files:**
- Create: `src/modules/acceptances/pdf-text.util.ts`
- Test: `src/modules/acceptances/pdf-text.util.spec.ts`
- Create: `test/fixtures/voucher-sample.pdf` (gerado por comando, não escrito à mão)

- [ ] **Step 1: Instalar a dependência**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/.wt-voucher-ia-api"
npm install pdfjs-dist@^4.10.38
```

Esperado: instala sem build nativo (é JS puro).

- [ ] **Step 2: Gerar o PDF de fixture com o Chromium que já existe no projeto**

Não commite um voucher real (tem dado de cliente). Este comando gera um PDF de verdade, com camada de texto, imitando o layout de um voucher de operadora:

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/.wt-voucher-ia-api"
mkdir -p test/fixtures
node -e "
const { chromium } = require('playwright');
const html = \`<!doctype html><html><body style='font-family:Arial;padding:40px'>
<h1>Voucher de Servicos</h1>
<p>Pedido: 61293</p>
<p>Localizador: JTT-8842-XK</p>
<p>Titular: Gabriela Menacho</p>
<table border=1 cellpadding=6>
<tr><th>Produto</th><th>Data</th><th>Adultos</th><th>Criancas</th></tr>
<tr><td>Magic Kingdom - 1 dia</td><td>12/09/2026</td><td>2</td><td>1</td></tr>
<tr><td>Universal Studios - 2 dias</td><td>14/09/2026</td><td>2</td><td>1</td></tr>
</table>
<p>Valido ate 31/12/2026. Nao reembolsavel. Necessario agendar horario no app do parque.</p>
</body></html>\`;
(async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.pdf({ path: 'test/fixtures/voucher-sample.pdf', format: 'A4', printBackground: true });
  await b.close();
  console.log('ok');
})();
"
```

Esperado: imprime `ok` e cria `test/fixtures/voucher-sample.pdf`.

- [ ] **Step 3: Escrever o teste que falha**

Create `src/modules/acceptances/pdf-text.util.spec.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { extractPdfText, MIN_USEFUL_CHARS } from './pdf-text.util';

const FIXTURE = path.join(__dirname, '../../../test/fixtures/voucher-sample.pdf');

describe('extractPdfText', () => {
  it('lê a camada de texto de um voucher e devolve o conteúdo', async () => {
    const buf = fs.readFileSync(FIXTURE);

    const text = await extractPdfText(buf);

    expect(text).toContain('Magic Kingdom');
    expect(text).toContain('61293');
    expect(text).toContain('JTT-8842-XK');
  });

  it('devolve vazio quando o PDF tem menos texto útil que o piso', async () => {
    const buf = fs.readFileSync(FIXTURE);
    // Piso artificialmente alto simula o PDF escaneado (sem camada de texto).
    const text = await extractPdfText(buf, MIN_USEFUL_CHARS * 1000);

    expect(text).toBe('');
  });

  it('devolve vazio em vez de estourar quando o buffer não é um PDF', async () => {
    const text = await extractPdfText(Buffer.from('isso não é um pdf'));

    expect(text).toBe('');
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

```bash
npm test -- pdf-text.util.spec.ts
```

Esperado: FAIL — `Cannot find module './pdf-text.util'`.

- [ ] **Step 5: Implementar**

Create `src/modules/acceptances/pdf-text.util.ts`:

```ts
import { Logger } from '@nestjs/common';

const logger = new Logger('PdfText');

/**
 * Piso de texto útil (caracteres, após colapsar espaços) para considerar que o
 * PDF tem camada de texto de verdade. Abaixo disso tratamos como ilegível
 * (escaneado) — mandar ruído pro LLM só produz invenção de volta.
 */
export const MIN_USEFUL_CHARS = 200;

/**
 * `pdfjs-dist` é ESM puro e este projeto compila para CommonJS
 * (`tsconfig.json` → `"module": "commonjs"`). Um `await import(...)` escrito
 * direto seria transpilado pelo TypeScript para `require()`, que falha em
 * runtime com ERR_REQUIRE_ESM. O `new Function` esconde o import do
 * transpilador, preservando o `import()` dinâmico nativo do Node.
 */
const esmImport = new Function('m', 'return import(m)') as (
  m: string,
) => Promise<any>;

/**
 * Extrai a camada de texto de um PDF. NUNCA lança: qualquer falha (arquivo
 * corrompido, PDF protegido, sem camada de texto) devolve string vazia, e quem
 * chama decide o que fazer — aqui a leitura é um bônus, não um bloqueio.
 */
export async function extractPdfText(
  buffer: Buffer,
  minUsefulChars: number = MIN_USEFUL_CHARS,
): Promise<string> {
  try {
    const pdfjs = await esmImport('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Sem worker: rodamos no processo do Node, não no browser.
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
          .join(' '),
      );
    }
    await doc.destroy();

    const text = pages.join('\n').replace(/[ \t]+/g, ' ').trim();
    return text.replace(/\s/g, '').length >= minUsefulChars ? text : '';
  } catch (err) {
    logger.warn(`falha ao ler PDF: ${(err as Error)?.message ?? err}`);
    return '';
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
npm test -- pdf-text.util.spec.ts
```

Esperado: PASS, 3 testes.

Se falhar com `ERR_MODULE_NOT_FOUND` apontando para `pdf.mjs`, confira o caminho real com `ls node_modules/pdfjs-dist/legacy/build/`. Se falhar com erro de `DOMMatrix`/`canvas`, é porque a versão instalada exige polyfill de canvas — nesse caso troque a dep por `pdf-parse@^1.1.1` (CommonJS, API `pdfParse(buffer) → { text }`), mantendo a mesma assinatura de `extractPdfText`. Os testes não mudam.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json test/fixtures/voucher-sample.pdf src/modules/acceptances/pdf-text.util.ts src/modules/acceptances/pdf-text.util.spec.ts
git commit -m "feat: extração de texto de PDF para leitura de voucher"
```

---

## Task 2: Extrator grounded do voucher

**Files:**
- Create: `src/modules/acceptances/voucher.prompts.ts`
- Create: `src/modules/acceptances/voucher-extractor.service.ts`
- Test: `src/modules/acceptances/voucher-extractor.service.spec.ts`
- Modify: `src/modules/acceptances/acceptances.types.ts`

- [ ] **Step 1: Estender os tipos**

Modify `src/modules/acceptances/acceptances.types.ts` — troque o `AcceptanceItem` existente e acrescente os novos tipos:

```ts
export interface AcceptanceItem {
  description: string;
  qty?: number;
  date?: string;
  note?: string;
  /** Localizador / nº de confirmação da operadora, quando veio de um voucher. */
  ref?: string;
}

/** Voucher entregue junto com o aceite. */
export interface VoucherRef {
  url: string;
  filename: string;
  size: number;
  /** SHA-256 do arquivo, calculado no backend. Prova que é aquele arquivo. */
  sha256: string;
}

/** O que o extrator devolve a partir do texto de UM voucher. */
export interface ExtractedVoucher {
  items: AcceptanceItem[];
  orderRef: string | null;
}
```

- [ ] **Step 2: Escrever o teste que falha**

Create `src/modules/acceptances/voucher-extractor.service.spec.ts`:

```ts
import { VoucherExtractorService } from './voucher-extractor.service';

function llmReturning(text: string) {
  return { complete: jest.fn().mockResolvedValue({ message: { content: text } }) } as any;
}

describe('VoucherExtractorService', () => {
  it('extrai itens e o nº do pedido do JSON do modelo', async () => {
    const llm = llmReturning(
      JSON.stringify({
        orderRef: '61293',
        items: [
          {
            description: 'Magic Kingdom - 1 dia',
            qty: 3,
            date: '12/09/2026',
            ref: 'JTT-8842-XK',
            note: 'Válido até 31/12/2026. Não reembolsável.',
          },
        ],
      }),
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto do voucher', 'org-1');

    expect(out.orderRef).toBe('61293');
    expect(out.items).toEqual([
      {
        description: 'Magic Kingdom - 1 dia',
        qty: 3,
        date: '12/09/2026',
        ref: 'JTT-8842-XK',
        note: 'Válido até 31/12/2026. Não reembolsável.',
      },
    ]);
  });

  it('descarta bloco <think> antes de parsear', async () => {
    const llm = llmReturning(
      '<think>deixa eu pensar</think>{"orderRef":null,"items":[{"description":"Ingresso"}]}',
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto', 'org-1');

    expect(out.items).toEqual([{ description: 'Ingresso' }]);
    expect(out.orderRef).toBeNull();
  });

  it('descarta item sem descrição em vez de propagar lixo', async () => {
    const llm = llmReturning(
      JSON.stringify({ items: [{ qty: 2 }, { description: '   ' }, { description: 'Ok' }] }),
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto', 'org-1');

    expect(out.items).toEqual([{ description: 'Ok' }]);
  });

  it('devolve vazio quando o LLM falha, sem estourar', async () => {
    const llm = { complete: jest.fn().mockRejectedValue(new Error('502')) } as any;
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto', 'org-1');

    expect(out).toEqual({ items: [], orderRef: null });
  });

  it('nem chama o LLM quando o texto está vazio', async () => {
    const llm = llmReturning('{}');
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('   ', 'org-1');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(out).toEqual({ items: [], orderRef: null });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
npm test -- voucher-extractor.service.spec.ts
```

Esperado: FAIL — `Cannot find module './voucher-extractor.service'`.

- [ ] **Step 4: Escrever o prompt**

Create `src/modules/acceptances/voucher.prompts.ts`:

```ts
/**
 * Extrator GROUNDED de voucher. A regra que mais importa aqui é a proibição de
 * deduzir: um voucher mal lido que inventa data manda o cliente ao parque no
 * dia errado. Preferimos campo ausente a campo adivinhado.
 */
export const VOUCHER_EXTRACT_SYSTEM_PROMPT = `Você extrai dados de vouchers de turismo (ingressos, passeios, traslados) para conferência do cliente.

Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{
  "orderRef": "número do pedido, ou null se não estiver escrito",
  "items": [
    {
      "description": "nome do produto/serviço como está escrito",
      "qty": número total de pessoas (adultos + crianças), omita se não houver,
      "date": "data de uso como está escrita, omita se não houver",
      "ref": "localizador/nº de confirmação daquele item, omita se não houver",
      "note": "validade e regras de uso relevantes, omita se não houver"
    }
  ]
}

REGRAS ABSOLUTAS:
- NUNCA invente ou deduza. Só registre o que está LITERALMENTE escrito no texto.
- Campo que não está escrito: omita. Nunca preencha com placeholder, "N/A" ou chute.
- NUNCA inclua valores, preços ou dados de pagamento.
- Um item por produto/serviço. Se o mesmo produto aparece para adulto e criança separadamente, some as quantidades num item só.
- Se o texto não for um voucher, devolva {"orderRef": null, "items": []}.`;
```

- [ ] **Step 5: Implementar o serviço**

Create `src/modules/acceptances/voucher-extractor.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../ai-agents/llm/llm.service';
import { SAKANA_SIMPLE_MODEL } from '../ai-agents/llm/llm.constants';
import { VOUCHER_EXTRACT_SYSTEM_PROMPT } from './voucher.prompts';
import { AcceptanceItem, ExtractedVoucher } from './acceptances.types';

const EMPTY: ExtractedVoucher = { items: [], orderRef: null };

/**
 * Extrator grounded (temp 0) dos itens de um voucher a partir do texto do PDF.
 * Espelha o `OrderExtractorService` da Ficha do Pedido, inclusive o parse
 * tolerante. Qualquer falha devolve vazio — a leitura é um bônus, o envio do
 * voucher não depende dela.
 */
@Injectable()
export class VoucherExtractorService {
  private readonly logger = new Logger(VoucherExtractorService.name);

  constructor(private readonly llm: LlmService) {}

  async extract(
    voucherText: string,
    organizationId: string,
  ): Promise<ExtractedVoucher> {
    if (!voucherText?.trim()) return EMPTY;

    try {
      const resp = await this.llm.complete({
        organizationId,
        modelId: SAKANA_SIMPLE_MODEL,
        temperature: 0,
        maxTokens: 1200,
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: VOUCHER_EXTRACT_SYSTEM_PROMPT, cache: true },
            ],
          },
          {
            role: 'user',
            content: `<<<VOUCHER>>>\n${voucherText}\n<<<END>>>`,
          },
        ],
      });

      return this.parse(this.textOnly(resp.message.content));
    } catch (err) {
      this.logger.warn(
        `extração de voucher falhou: ${(err as Error)?.message ?? err}`,
      );
      return EMPTY;
    }
  }

  private textOnly(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === 'string') return content;
    return content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }

  /** Tira `<think>...</think>`, pega o primeiro `{...}` balanceado, filtra lixo. */
  private parse(raw: string): ExtractedVoucher {
    try {
      const noThink = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      const start = noThink.indexOf('{');
      const end = noThink.lastIndexOf('}');
      if (start < 0 || end <= start) return EMPTY;

      const j = JSON.parse(noThink.slice(start, end + 1));

      return {
        items: this.normalizeItems(j.items),
        orderRef:
          typeof j.orderRef === 'string' && j.orderRef.trim()
            ? j.orderRef.trim()
            : null,
      };
    } catch {
      return EMPTY;
    }
  }

  private normalizeItems(raw: unknown): AcceptanceItem[] {
    if (!Array.isArray(raw)) return [];
    const out: AcceptanceItem[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const r = entry as Record<string, unknown>;
      if (typeof r.description !== 'string' || !r.description.trim()) continue;

      const item: AcceptanceItem = { description: r.description.trim() };
      if (typeof r.qty === 'number' && Number.isFinite(r.qty)) item.qty = r.qty;
      if (typeof r.date === 'string' && r.date.trim()) item.date = r.date.trim();
      if (typeof r.ref === 'string' && r.ref.trim()) item.ref = r.ref.trim();
      if (typeof r.note === 'string' && r.note.trim()) item.note = r.note.trim();
      out.push(item);
    }
    return out;
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
npm test -- voucher-extractor.service.spec.ts
```

Esperado: PASS, 5 testes.

- [ ] **Step 7: Commit**

```bash
git add src/modules/acceptances/voucher.prompts.ts src/modules/acceptances/voucher-extractor.service.ts src/modules/acceptances/voucher-extractor.service.spec.ts src/modules/acceptances/acceptances.types.ts
git commit -m "feat: extrator grounded de itens do voucher"
```

---

## Task 3: Migration aditiva

**Files:**
- Modify: `prisma/schema.prisma` (model `OrderAcceptance`, ~linha 2339)
- Create: `prisma/migrations/20260806000000_add_acceptance_vouchers/migration.sql`

- [ ] **Step 1: Acrescentar os campos ao schema**

Modify `prisma/schema.prisma`, dentro de `model OrderAcceptance`, logo depois da linha `status   AcceptanceStatus @default(PENDING)`:

```prisma
  /** Vouchers entregues: [{ url, filename, size, sha256 }]. */
  vouchers Json?   @default("[]")
  /** Nº do pedido lido do voucher, exibido no cabeçalho da página pública. */
  orderRef String? @map("order_ref")
```

- [ ] **Step 2: Escrever a migration à mão**

O projeto tem histórico de migration quebrada por geração automática. Escreva o SQL direto.

Create `prisma/migrations/20260806000000_add_acceptance_vouchers/migration.sql`:

```sql
-- Aditiva: nenhuma coluna existente é alterada, nenhum dado é reescrito.
ALTER TABLE "order_acceptances" ADD COLUMN "vouchers" JSONB DEFAULT '[]';
ALTER TABLE "order_acceptances" ADD COLUMN "order_ref" TEXT;
```

- [ ] **Step 3: Aplicar e gerar o client**

```bash
npx prisma migrate dev --name add_acceptance_vouchers
npx prisma generate
```

Esperado: `Applied migration`. Se der erro sobre `cadence_revive`, é o bug conhecido de `ALTER TYPE ADD VALUE` usado na mesma migration — o banco de produção já está resolvido; num banco local sujo, use um banco limpo em vez de tentar consertar aquela migration.

- [ ] **Step 4: Confirmar que o client tipou os campos novos**

```bash
npx tsc --noEmit
```

Esperado: sem erro.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: campos vouchers e orderRef no aceite"
```

---

## Task 4: Endpoint de extração

**Files:**
- Create: `src/modules/acceptances/storage-key.util.ts`
- Test: `src/modules/acceptances/storage-key.util.spec.ts`
- Create: `src/modules/acceptances/dto/extract-voucher.dto.ts`
- Modify: `src/modules/acceptances/acceptances.service.ts`
- Modify: `src/modules/acceptances/acceptances.controller.ts`
- Modify: `src/modules/acceptances/acceptances.module.ts`
- Test: `src/modules/acceptances/acceptances.service.spec.ts`

- [ ] **Step 1: Teste da conversão URL → chave**

Create `src/modules/acceptances/storage-key.util.spec.ts`:

```ts
import { storageKeyFromUploadUrl } from './storage-key.util';

describe('storageKeyFromUploadUrl', () => {
  it('extrai a chave de uma URL de upload', () => {
    expect(
      storageKeyFromUploadUrl(
        'https://api.exemplo.com/api/v1/uploads/media/2026-08-06/abc123.pdf',
      ),
    ).toBe('media/2026-08-06/abc123.pdf');
  });

  it('aceita a chave crua (sem host)', () => {
    expect(storageKeyFromUploadUrl('media/2026-08-06/abc123.pdf')).toBe(
      'media/2026-08-06/abc123.pdf',
    );
  });

  it('devolve null para URL de outro domínio/rota — nunca lê fora do storage', () => {
    expect(storageKeyFromUploadUrl('https://evil.com/etc/passwd')).toBeNull();
  });

  it('devolve null para travessia de diretório', () => {
    expect(
      storageKeyFromUploadUrl('https://api.exemplo.com/api/v1/uploads/../../secret'),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test -- storage-key.util.spec.ts
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Create `src/modules/acceptances/storage-key.util.ts`:

```ts
const UPLOADS_MARKER = '/api/v1/uploads/';

/**
 * Converte a URL pública devolvida por `POST messages/uploads/media` na chave
 * do objeto no storage. Devolve `null` para qualquer coisa que não seja um
 * upload nosso — o endpoint de extração recebe URL do cliente, e sem essa
 * checagem viraria um leitor de arquivo arbitrário.
 */
export function storageKeyFromUploadUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  const idx = url.indexOf(UPLOADS_MARKER);
  const key = idx >= 0 ? url.slice(idx + UPLOADS_MARKER.length) : url;

  if (!key || key.includes('..') || key.startsWith('/')) return null;
  if (idx < 0 && /^[a-z]+:\/\//i.test(url)) return null;
  return key;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm test -- storage-key.util.spec.ts
```

Esperado: PASS, 4 testes.

- [ ] **Step 5: Teste do método de serviço**

Modify `src/modules/acceptances/acceptances.service.spec.ts` — acrescente ao final do arquivo, dentro do `describe` de topo já existente:

```ts
  describe('extractVoucher', () => {
    function build(overrides: {
      buffer?: Buffer;
      text?: string;
      extracted?: { items: any[]; orderRef: string | null };
    }) {
      const storage = {
        getBuffer: jest.fn().mockResolvedValue(overrides.buffer ?? Buffer.from('x')),
      } as any;
      const extractor = {
        extract: jest
          .fn()
          .mockResolvedValue(overrides.extracted ?? { items: [], orderRef: null }),
      } as any;
      const svc = new AcceptancesService(
        {} as any,
        {} as any,
        {} as any,
        storage,
        extractor,
      );
      // A leitura do PDF é trocada por um stub: o teste é do fluxo do serviço,
      // não do pdfjs (esse já tem teste próprio em pdf-text.util.spec.ts).
      (svc as any).readPdfText = jest.fn().mockResolvedValue(overrides.text ?? '');
      return { svc, storage, extractor };
    }

    it('devolve aviso e não chama o LLM quando o PDF não tem texto', async () => {
      const { svc, extractor } = build({ text: '' });

      const out = await svc.extractVoucher('org-1', {
        mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
      });

      expect(extractor.extract).not.toHaveBeenCalled();
      expect(out.items).toEqual([]);
      expect(out.warning).toMatch(/não consegui ler/i);
    });

    it('devolve os itens extraídos quando o PDF tem texto', async () => {
      const { svc } = build({
        text: 'texto do voucher',
        extracted: { items: [{ description: 'Magic Kingdom' }], orderRef: '61293' },
      });

      const out = await svc.extractVoucher('org-1', {
        mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
      });

      expect(out.items).toEqual([{ description: 'Magic Kingdom' }]);
      expect(out.orderRef).toBe('61293');
      expect(out.warning).toBeUndefined();
    });

    it('recusa URL que não é upload nosso', async () => {
      const { svc, storage } = build({});

      await expect(
        svc.extractVoucher('org-1', { mediaUrl: 'https://evil.com/etc/passwd' }),
      ).rejects.toThrow(BadRequestException);
      expect(storage.getBuffer).not.toHaveBeenCalled();
    });
  });
```

Confira o topo do arquivo: precisa de `import { BadRequestException } from '@nestjs/common';`. Se os testes existentes constroem o `AcceptancesService` com menos argumentos, atualize essas construções para incluir os dois novos (`storage`, `extractor`) — o construtor mudou.

- [ ] **Step 6: Rodar e ver falhar**

```bash
npm test -- acceptances.service.spec.ts
```

Esperado: FAIL — `svc.extractVoucher is not a function`.

- [ ] **Step 7: Implementar no serviço**

Modify `src/modules/acceptances/acceptances.service.ts`:

Nos imports, acrescente:

```ts
import { VoucherExtractorService } from './voucher-extractor.service';
import { extractPdfText } from './pdf-text.util';
import { storageKeyFromUploadUrl } from './storage-key.util';
import { AcceptanceItem, PublicAcceptanceView, VoucherRef } from './acceptances.types';
```

No construtor, acrescente o último parâmetro (obrigatório — nada de `?`, que derruba o boot):

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: AcceptancePdfService,
    private readonly effects: AcceptanceEffectsService,
    private readonly storage: StorageService,
    private readonly voucherExtractor: VoucherExtractorService,
  ) {}
```

E acrescente os métodos (pode ser logo depois de `createForConversation`):

```ts
  /**
   * Indireção fina para o `extractPdfText`, só para o teste do fluxo poder
   * substituir a leitura sem carregar o pdfjs.
   */
  protected readPdfText(buffer: Buffer): Promise<string> {
    return extractPdfText(buffer);
  }

  /**
   * Lê um voucher já subido via `messages/uploads/media` e devolve os itens
   * para o modal preencher. Falha suave: PDF ilegível devolve lista vazia com
   * aviso, nunca erro — o atendente segue digitando à mão e o envio continua.
   */
  async extractVoucher(
    organizationId: string,
    input: { mediaUrl: string },
  ): Promise<{ items: AcceptanceItem[]; orderRef: string | null; warning?: string }> {
    const key = storageKeyFromUploadUrl(input.mediaUrl);
    if (!key) {
      throw new BadRequestException('Arquivo inválido para leitura.');
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.getBuffer(key);
    } catch (err) {
      this.logger.warn(`voucher não encontrado no storage (${key}): ${(err as Error)?.message}`);
      throw new NotFoundException('Arquivo não encontrado.');
    }

    const text = await this.readPdfText(buffer);
    if (!text) {
      return {
        items: [],
        orderRef: null,
        warning:
          'Não consegui ler este PDF (provavelmente é uma imagem escaneada). Confira os itens à mão — o voucher será enviado normalmente.',
      };
    }

    const { items, orderRef } = await this.voucherExtractor.extract(
      text,
      organizationId,
    );
    return { items, orderRef };
  }
```

- [ ] **Step 8: DTO**

Create `src/modules/acceptances/dto/extract-voucher.dto.ts`:

```ts
import { IsString, MaxLength } from 'class-validator';

export class ExtractVoucherDto {
  @IsString()
  @MaxLength(2048)
  mediaUrl!: string;
}
```

- [ ] **Step 9: Rota no controller**

Modify `src/modules/acceptances/acceptances.controller.ts` — acrescente o import e o método:

```ts
import { Body } from '@nestjs/common';
import { ExtractVoucherDto } from './dto/extract-voucher.dto';
```

```ts
  @Post('extract-voucher')
  extractVoucher(
    @Body() dto: ExtractVoucherDto,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.extractVoucher(orgId, { mediaUrl: dto.mediaUrl });
  }
```

**Atenção à ordem das rotas:** `@Post('extract-voucher')` precisa vir **antes** de `@Post(':id/resend')`, senão o Nest casa `extract-voucher` como `:id`.

- [ ] **Step 10: Registrar o provider**

Modify `src/modules/acceptances/acceptances.module.ts`:

```ts
import { LlmModule } from '../ai-agents/llm/llm.module';
import { VoucherExtractorService } from './voucher-extractor.service';
```

```ts
  imports: [PrismaModule, LlmModule],
```

```ts
  providers: [
    AcceptancesService,
    AcceptanceEffectsService,
    VoucherExtractorService,
    { provide: AcceptancePdfService, useFactory: () => new AcceptancePdfService(chromium) },
  ],
```

Se `LlmModule` não exportar `LlmService`, exporte-o lá. Confira antes com:
`grep -n "exports" src/modules/ai-agents/llm/llm.module.ts`

- [ ] **Step 11: Rodar e ver passar**

```bash
npm test -- acceptances.service.spec.ts storage-key.util.spec.ts
```

Esperado: PASS.

- [ ] **Step 12: Verificar que a aplicação sobe de verdade**

O maior risco desta base é DI que só quebra no boot. O guarda de ciclo não pega tudo:

```bash
npm test -- di-cycle
npx tsc --noEmit
```

Esperado: PASS e sem erro de tipo. Se `npm test -- di-cycle` não casar nenhum arquivo, rode a suíte inteira (`npm test`).

- [ ] **Step 13: Commit**

```bash
git add src/modules/acceptances
git commit -m "feat: endpoint de extração de voucher"
```

---

## Task 5: Persistir vouchers com hash

**Files:**
- Modify: `src/modules/acceptances/acceptances.service.ts`
- Modify: `src/modules/acceptances/dto/create-acceptance.dto.ts`
- Test: `src/modules/acceptances/acceptances.service.spec.ts`

- [ ] **Step 1: Teste**

Modify `src/modules/acceptances/acceptances.service.spec.ts` — acrescente:

```ts
  describe('createForConversation com vouchers', () => {
    it('calcula o SHA-256 do arquivo no backend e persiste', async () => {
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br';
      const created: any[] = [];
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c1',
            contactId: 'ct1',
            organization: { name: 'OFP' },
          }),
        },
        card: { findFirst: jest.fn().mockResolvedValue({ id: 'card1' }) },
        orderAcceptance: {
          create: jest.fn().mockImplementation((args: any) => {
            created.push(args.data);
            return { ...args.data, id: 'acc1' };
          }),
        },
      } as any;
      const storage = {
        getBuffer: jest.fn().mockResolvedValue(Buffer.from('conteudo-do-pdf')),
      } as any;
      const svc = new AcceptancesService(prisma, {} as any, {} as any, storage, {} as any);

      await svc.createForConversation('org-1', 'c1', {
        items: [{ description: 'Magic Kingdom' }],
        createdById: 'u1',
        orderRef: '61293',
        vouchers: [
          {
            url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
            filename: 'voucher.pdf',
            size: 15,
          },
        ],
      });

      const sha = require('crypto')
        .createHash('sha256')
        .update(Buffer.from('conteudo-do-pdf'))
        .digest('hex');
      expect(created[0].orderRef).toBe('61293');
      expect(created[0].vouchers).toEqual([
        {
          url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
          filename: 'voucher.pdf',
          size: 15,
          sha256: sha,
        },
      ]);
    });

    it('persiste o voucher sem hash quando o arquivo some do storage', async () => {
      process.env.APP_PUBLIC_URL = 'https://sendtur.com.br';
      const created: any[] = [];
      const prisma = {
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c1',
            contactId: 'ct1',
            organization: { name: 'OFP' },
          }),
        },
        card: { findFirst: jest.fn().mockResolvedValue(null) },
        orderAcceptance: {
          create: jest.fn().mockImplementation((args: any) => {
            created.push(args.data);
            return { ...args.data, id: 'acc1' };
          }),
        },
      } as any;
      const storage = {
        getBuffer: jest.fn().mockRejectedValue(new Error('NoSuchKey')),
      } as any;
      const svc = new AcceptancesService(prisma, {} as any, {} as any, storage, {} as any);

      await svc.createForConversation('org-1', 'c1', {
        items: [{ description: 'X' }],
        createdById: 'u1',
        vouchers: [
          { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v.pdf', size: 9 },
        ],
      });

      expect(created[0].vouchers[0].sha256).toBe('');
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test -- acceptances.service.spec.ts
```

Esperado: FAIL — `created[0].vouchers` é `undefined`.

- [ ] **Step 3: Implementar**

Modify `src/modules/acceptances/acceptances.service.ts`:

No topo, `import * as crypto from 'crypto';`

Acrescente o método privado:

```ts
  /**
   * Calcula o SHA-256 de cada voucher lendo o arquivo do storage. O hash é
   * calculado AQUI, não no navegador: hash mandado pelo client não prova nada.
   * Arquivo ilegível vira hash vazio — o aceite não pode ser bloqueado por
   * isso, mas o comprovante deixa claro quando não há hash.
   */
  private async withHashes(
    vouchers: Array<{ url: string; filename: string; size: number }>,
  ): Promise<VoucherRef[]> {
    return Promise.all(
      vouchers.map(async (v) => {
        const key = storageKeyFromUploadUrl(v.url);
        if (!key) return { ...v, sha256: '' };
        try {
          const buf = await this.storage.getBuffer(key);
          return {
            ...v,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          };
        } catch (err) {
          this.logger.warn(
            `sem hash para ${v.filename}: ${(err as Error)?.message ?? err}`,
          );
          return { ...v, sha256: '' };
        }
      }),
    );
  }
```

Altere a assinatura de `createForConversation` para aceitar os campos novos:

```ts
    input: {
      items: AcceptanceItem[];
      termText?: string;
      createdById: string;
      vouchers?: Array<{ url: string; filename: string; size: number }>;
      orderRef?: string;
    },
```

E dentro dele, antes do `prisma.orderAcceptance.create`:

```ts
    const vouchers = input.vouchers?.length
      ? await this.withHashes(input.vouchers)
      : [];
```

No `data` do `create`, acrescente:

```ts
        vouchers: vouchers as any,
        orderRef: input.orderRef?.trim() || null,
```

- [ ] **Step 4: Estender o DTO**

Modify `src/modules/acceptances/dto/create-acceptance.dto.ts`:

Em `AcceptanceItemDto`, acrescente:

```ts
  @IsOptional()
  @IsString()
  ref?: string;
```

Acrescente a classe do voucher e os campos no `OrderSentDto`:

```ts
export class VoucherRefDto {
  @IsString()
  url!: string;

  @IsString()
  filename!: string;

  @IsNumber()
  size!: number;
}
```

```ts
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoucherRefDto)
  vouchers?: VoucherRefDto[];

  @IsOptional()
  @IsString()
  orderRef?: string;
```

- [ ] **Step 5: Rodar e ver passar**

```bash
npm test -- acceptances.service.spec.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/acceptances
git commit -m "feat: persiste vouchers com SHA-256 no aceite"
```

---

## Task 6: `order-sent` envia os PDFs

**Files:**
- Modify: `src/modules/pipelines/pipelines.service.ts:510-579`
- Modify: `src/modules/pipelines/pipelines.controller.ts:172-193`
- Test: `src/modules/pipelines/pipelines.order-sent.spec.ts`

- [ ] **Step 1: Teste**

Modify `src/modules/pipelines/pipelines.order-sent.spec.ts` — acrescente ao `describe` existente. Reaproveite o helper de construção do serviço que já existe no arquivo; se ele não permitir injetar `messages`/`acceptances`, ajuste-o em vez de duplicar.

```ts
  it('envia cada voucher como DOCUMENT antes da mensagem do link', async () => {
    const { service, messages, acceptances } = buildService();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });

    await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'Magic Kingdom' }],
      createdById: 'u1',
      vouchers: [
        { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v1.pdf', size: 10 },
      ],
    });

    const types = messages.send.mock.calls.map((c: any[]) => c[0].type);
    expect(types).toEqual(['DOCUMENT', 'TEXT']);
    expect(messages.send.mock.calls[0][0].content).toMatchObject({
      mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
      mimeType: 'application/pdf',
      fileSize: 10,
      filename: 'v1.pdf',
    });
  });

  it('cria o aceite e reporta a falha quando o envio de um voucher falha', async () => {
    const { service, messages, acceptances } = buildService();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockImplementation((dto: any) => {
      if (dto.type === 'DOCUMENT') throw new Error('janela de 24h fechada');
      return { id: 'm1' };
    });

    const out = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [
        { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v1.pdf', size: 10 },
      ],
    });

    expect(acceptances.createForConversation).toHaveBeenCalled();
    expect(out.acceptanceLink).toBe('https://sendtur.com.br/aceite/tok');
    expect(out.voucherResults).toEqual([
      { filename: 'v1.pdf', sent: false, error: 'janela de 24h fechada' },
    ]);
  });

  it('continua movendo o card quando withAcceptance é false', async () => {
    const { service, messages, acceptances } = buildService();

    await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: false,
    });

    expect(acceptances.createForConversation).not.toHaveBeenCalled();
    expect(messages.send).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test -- pipelines.order-sent.spec.ts
```

Esperado: FAIL — nenhum `DOCUMENT` é enviado.

- [ ] **Step 3: Implementar**

Modify `src/modules/pipelines/pipelines.service.ts` — dentro de `markOrderSentForConversation`, acrescente `vouchers`/`orderRef` ao `opts`:

```ts
    opts?: {
      withAcceptance?: boolean;
      items?: AcceptanceItem[];
      termText?: string;
      createdById?: string;
      vouchers?: Array<{ url: string; filename: string; size: number }>;
      orderRef?: string;
    },
```

Substitua o bloco do e-aceite (linhas ~552-576) por:

```ts
    // E-aceite (opcional): se o atendente pediu o aceite (withAcceptance !==
    // false) e mandou os itens + quem cria, envia os vouchers, gera o aceite e
    // envia o link no WhatsApp. Sem isso, é só o legado.
    let acceptanceLink: string | undefined;
    let voucherResults: Array<{ filename: string; sent: boolean; error?: string }> | undefined;

    if (opts?.withAcceptance !== false && opts?.items && opts.createdById) {
      // Os PDFs vão ANTES do link: o cliente recebe o voucher e só então o
      // pedido de conferência. Falha de um voucher não derruba os outros nem
      // impede a criação do aceite — o atendente vê o que faltou e reenvia.
      voucherResults = [];
      for (const v of opts.vouchers ?? []) {
        try {
          await this.messages.send(
            {
              conversationId,
              type: 'DOCUMENT',
              content: {
                mediaUrl: v.url,
                mimeType: 'application/pdf',
                fileSize: v.size,
                filename: v.filename,
              },
            } as any,
            opts.createdById,
            organizationId,
            'ALL',
            role,
            // Mesmas flags da mensagem do link logo abaixo, por consistência.
            { system: true, automated: true },
          );
          voucherResults.push({ filename: v.filename, sent: true });
        } catch (err) {
          const message = (err as Error)?.message ?? 'falha no envio';
          this.logger?.warn?.(`voucher ${v.filename} não enviado: ${message}`);
          voucherResults.push({ filename: v.filename, sent: false, error: message });
        }
      }

      const { link } = await this.acceptances.createForConversation(
        organizationId,
        conversationId,
        {
          items: opts.items,
          termText: opts.termText,
          createdById: opts.createdById,
          vouchers: opts.vouchers,
          orderRef: opts.orderRef,
        },
      );
      acceptanceLink = link;
      const text = `Prontinho! ✅ Já enviamos tudo pra você.\n\nPra finalizar, é só dar uma conferida nos itens que você recebeu e confirmar o recebimento neste link (leva menos de 1 minuto):\n\n${link}\n\nEle também serve como seu comprovante. Qualquer coisa, é só chamar por aqui! 😊`;
      await this.messages.send(
        { conversationId, type: 'TEXT', content: { text } } as any,
        opts.createdById,
        organizationId,
        'ALL',
        role,
        { system: true, automated: true },
      );
    }

    return { ...(moved as any), acceptanceLink, voucherResults };
```

Se a classe não tiver `private readonly logger`, troque `this.logger?.warn?.(...)` por um `Logger` já existente no arquivo, ou remova a linha — não invente um logger novo só para isso.

**Nota deliberada:** `{ system: true }` a partir de um handler HTTP contraria o aviso no docblock de `MessagesService.send`. O código atual do link já faz isso; manter igual evita mudar quem pode marcar "Pedido enviado". Corrigir é outra fatia.

- [ ] **Step 4: Passar os campos no controller**

Modify `src/modules/pipelines/pipelines.controller.ts`, no `markOrderSent`, acrescente ao objeto de opções:

```ts
        vouchers: body?.vouchers,
        orderRef: body?.orderRef,
```

- [ ] **Step 5: Rodar e ver passar**

```bash
npm test -- pipelines.order-sent.spec.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pipelines
git commit -m "feat: order-sent envia os vouchers junto com o link de aceite"
```

---

## Task 7: Vouchers na página pública e no comprovante

**Files:**
- Modify: `src/modules/acceptances/acceptances.types.ts`
- Modify: `src/modules/acceptances/acceptances.service.ts` (`getByToken`, `sign`)
- Modify: `src/modules/acceptances/acceptance-pdf.service.ts`
- Test: `src/modules/acceptances/acceptance-pdf.service.spec.ts`

- [ ] **Step 1: Estender a view pública**

Modify `src/modules/acceptances/acceptances.types.ts`:

```ts
export interface PublicAcceptanceView {
  status: 'PENDING' | 'SIGNED' | 'EXPIRED' | 'CANCELED';
  organizationName: string;
  items: AcceptanceItem[];
  termText: string;
  signedAt: string | null;
  signerName: string | null;
  pdfUrl: string | null;
  /** Vouchers entregues, para o cliente conferir antes de assinar. */
  vouchers: VoucherRef[];
  orderRef: string | null;
}
```

- [ ] **Step 2: Teste do comprovante**

Modify `src/modules/acceptances/acceptance-pdf.service.spec.ts` — acrescente:

```ts
  it('lista os vouchers entregues com nome e hash no HTML do comprovante', () => {
    const svc = new AcceptancePdfService({} as any);

    const html = (svc as any).html({
      organizationName: 'OFP',
      termText: 'Confirmo o recebimento.',
      items: [{ description: 'Magic Kingdom' }],
      signerName: 'Gabriela',
      signedAt: new Date('2026-08-06T12:00:00Z'),
      vouchers: [{ url: 'https://x/a.pdf', filename: 'voucher.pdf', size: 10, sha256: 'abc123' }],
      orderRef: '61293',
    });

    expect(html).toContain('voucher.pdf');
    expect(html).toContain('abc123');
    expect(html).toContain('61293');
  });

  it('não quebra quando não há voucher', () => {
    const svc = new AcceptancePdfService({} as any);

    const html = (svc as any).html({
      organizationName: 'OFP',
      termText: 'Confirmo.',
      items: [{ description: 'X' }],
      signerName: 'Ana',
      signedAt: new Date('2026-08-06T12:00:00Z'),
    });

    expect(html).toContain('Ana');
    expect(html).not.toContain('Vouchers entregues');
  });
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
npm test -- acceptance-pdf.service.spec.ts
```

Esperado: FAIL — o HTML não contém `voucher.pdf`.

- [ ] **Step 4: Implementar no PDF**

Modify `src/modules/acceptances/acceptance-pdf.service.ts`:

Na interface:

```ts
export interface AcceptancePdfInput {
  organizationName: string;
  termText: string;
  items: AcceptanceItem[];
  signerName: string;
  signedAt: Date;
  signerIp?: string | null;
  vouchers?: VoucherRef[];
  orderRef?: string | null;
}
```

(acrescente `VoucherRef` ao import de `./acceptances.types`)

No método `html`, antes do `return`:

```ts
    const voucherRows = (i.vouchers ?? [])
      .map(
        (v) =>
          `<li>${esc(v.filename)}${
            v.sha256 ? ` — <code style="font-size:10px">SHA-256: ${esc(v.sha256)}</code>` : ''
          }</li>`,
      )
      .join('');
    const voucherBlock = voucherRows
      ? `<h3>Vouchers entregues</h3><ul>${voucherRows}</ul>`
      : '';
    const orderBlock = i.orderRef
      ? `<p><strong>Pedido:</strong> ${esc(i.orderRef)}</p>`
      : '';
```

E no template, troque a linha do `<h1>` e acrescente o bloco depois dos itens:

```ts
      <h1>Comprovante de Aceite — ${esc(i.organizationName)}</h1>
      ${orderBlock}
      <p>${esc(i.termText)}</p>
      <h3>Itens conferidos</h3><ul>${rows}</ul>
      ${voucherBlock}
```

- [ ] **Step 5: Passar os dados no serviço**

Modify `src/modules/acceptances/acceptances.service.ts`:

Em `getByToken`, no objeto de retorno, acrescente:

```ts
      vouchers: ((acc.vouchers as any) ?? []) as VoucherRef[],
      orderRef: acc.orderRef ?? null,
```

Em `sign`, na chamada `this.pdf.render({...})`, acrescente:

```ts
      vouchers: ((acc.vouchers as any) ?? []) as VoucherRef[],
      orderRef: acc.orderRef ?? null,
```

E confira o retorno de `sign`: ele monta uma `PublicAcceptanceView` — acrescente os mesmos dois campos lá também, senão o TypeScript acusa campo faltando.

- [ ] **Step 6: Rodar tudo e ver passar**

```bash
npm test
npx tsc --noEmit
```

Esperado: suíte inteira verde, sem erro de tipo.

- [ ] **Step 7: Commit**

```bash
git add src/modules/acceptances
git commit -m "feat: vouchers e nº do pedido na view pública e no comprovante"
```

---

## Task 8: Web — tipos e serviços

**Files:**
- Modify: `src/features/acceptances/types.ts`
- Modify: `src/features/acceptances/services/acceptances.service.ts`
- Modify: `src/features/pipelines/services/pipelines.service.ts`

Trabalhe agora no worktree do web: `.wt-voucher-ia-web`.

- [ ] **Step 1: Tipos**

Modify `src/features/acceptances/types.ts`:

```ts
export interface AcceptanceItem {
  description: string;
  qty?: number;
  date?: string;
  note?: string;
  /** Localizador / nº de confirmação, quando o item veio de um voucher. */
  ref?: string;
}

export interface VoucherRef {
  url: string;
  filename: string;
  size: number;
  sha256: string;
}
```

E em `PublicAcceptanceView`, acrescente:

```ts
  vouchers: VoucherRef[];
  orderRef: string | null;
```

- [ ] **Step 2: Serviço de extração**

Modify `src/features/acceptances/services/acceptances.service.ts` — acrescente o método ao objeto exportado (siga o padrão de unwrap `data.data ?? data` que o arquivo já usa):

```ts
  /**
   * Lê um voucher já subido e devolve os itens pro modal preencher.
   * `warning` presente = PDF ilegível; o envio segue normalmente.
   */
  async extractVoucher(mediaUrl: string): Promise<{
    items: AcceptanceItem[];
    orderRef: string | null;
    warning?: string;
  }> {
    const { data } = await api.post('/acceptances/extract-voucher', { mediaUrl });
    return data.data ?? data;
  },
```

Garanta que `AcceptanceItem` esteja importado no arquivo.

- [ ] **Step 3: `markOrderSent` com vouchers**

Modify `src/features/pipelines/services/pipelines.service.ts:277-295`:

```ts
  async markOrderSent(
    conversationId: string,
    payload?: {
      withAcceptance?: boolean;
      items?: {
        description: string;
        qty?: number;
        date?: string;
        note?: string;
        ref?: string;
      }[];
      termText?: string;
      vouchers?: { url: string; filename: string; size: number }[];
      orderRef?: string;
    },
  ): Promise<
    CardSummary & {
      acceptanceLink?: string;
      voucherResults?: { filename: string; sent: boolean; error?: string }[];
    }
  > {
    const { data } = await api.post(
      `/pipelines/conversations/${conversationId}/order-sent`,
      payload ?? {},
    );
    return data.data ?? data;
  },
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Esperado: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/features/acceptances src/features/pipelines
git commit -m "feat: tipos e serviços do voucher no aceite"
```

---

## Task 9: Web — mescla de itens

**Files:**
- Create: `src/features/acceptances/voucher-merge.ts`
- Test: `src/features/acceptances/voucher-merge.test.ts`

- [ ] **Step 1: Teste**

Create `src/features/acceptances/voucher-merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeVoucherItems, pickOrderRef } from './voucher-merge';

describe('mergeVoucherItems', () => {
  it('mantém os itens do rascunho quando o voucher não traz nada', () => {
    const draft = [{ description: 'Magic Kingdom' }];

    expect(mergeVoucherItems(draft, [])).toEqual(draft);
  });

  it('substitui o item do rascunho quando descrição e data coincidem', () => {
    const draft = [{ description: 'Magic Kingdom', qty: 2 }];
    const fromVoucher = [
      { description: 'magic  kingdom', qty: 3, ref: 'JTT-1', note: 'Válido até 31/12' },
    ];

    expect(mergeVoucherItems(draft, fromVoucher)).toEqual([
      { description: 'magic  kingdom', qty: 3, ref: 'JTT-1', note: 'Válido até 31/12' },
    ]);
  });

  it('trata acento e caixa como o mesmo item', () => {
    const draft = [{ description: 'Ingresso Único' }];
    const fromVoucher = [{ description: 'ingresso unico', qty: 1 }];

    expect(mergeVoucherItems(draft, fromVoucher)).toHaveLength(1);
  });

  it('não funde itens com a mesma descrição e datas diferentes', () => {
    const draft = [{ description: 'Universal', date: '14/09/2026' }];
    const fromVoucher = [{ description: 'Universal', date: '15/09/2026' }];

    expect(mergeVoucherItems(draft, fromVoucher)).toHaveLength(2);
  });

  it('acrescenta item novo preservando a ordem do rascunho primeiro', () => {
    const draft = [{ description: 'A' }];
    const fromVoucher = [{ description: 'B' }];

    expect(mergeVoucherItems(draft, fromVoucher).map((i) => i.description)).toEqual(['A', 'B']);
  });

  it('não muta os arrays recebidos', () => {
    const draft = [{ description: 'A' }];
    const fromVoucher = [{ description: 'B' }];

    mergeVoucherItems(draft, fromVoucher);

    expect(draft).toEqual([{ description: 'A' }]);
    expect(fromVoucher).toEqual([{ description: 'B' }]);
  });
});

describe('pickOrderRef', () => {
  it('devolve o primeiro não-vazio sem conflito', () => {
    expect(pickOrderRef([null, '61293', '61293'])).toEqual({
      orderRef: '61293',
      conflict: false,
    });
  });

  it('sinaliza conflito quando dois vouchers trazem pedidos diferentes', () => {
    expect(pickOrderRef(['61293', '99999'])).toEqual({
      orderRef: '61293',
      conflict: true,
    });
  });

  it('devolve null quando nenhum voucher traz pedido', () => {
    expect(pickOrderRef([null, null])).toEqual({ orderRef: null, conflict: false });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npx vitest run src/features/acceptances/voucher-merge.test.ts
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

Create `src/features/acceptances/voucher-merge.ts`:

```ts
import type { AcceptanceItem } from './types';

/**
 * Chave de identidade de um item: descrição normalizada + data. Normalizar
 * caixa, acento e espaço evita duplicar "Ingresso Único" e "ingresso unico",
 * que é como a Ficha do Pedido e o voucher costumam divergir.
 */
function itemKey(item: AcceptanceItem): string {
  const desc = item.description
    .normalize('NFD')
    // Remove as marcas de acento que o NFD separou. Mantenha o escape
    // \u0300-\u036f: escrever o intervalo com os caracteres literais funciona,
    // mas eles são invisíveis no editor e somem no primeiro "limpa arquivo".
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${desc}|${(item.date ?? '').trim()}`;
}

/**
 * Mescla os itens lidos do voucher no rascunho vindo da Ficha do Pedido.
 *
 * Em empate, **vence o item do voucher**: a Ficha registra o que o cliente
 * pediu; o voucher é o que foi entregue — e é a entrega que ele assina.
 * Sempre devolve arrays novos (nada de mutar a entrada).
 */
export function mergeVoucherItems(
  draft: AcceptanceItem[],
  fromVoucher: AcceptanceItem[],
): AcceptanceItem[] {
  if (fromVoucher.length === 0) return [...draft];

  const byKey = new Map<string, AcceptanceItem>();
  for (const item of fromVoucher) byKey.set(itemKey(item), item);

  const merged = draft.map((item) => byKey.get(itemKey(item)) ?? item);
  const usedKeys = new Set(draft.map(itemKey));
  const novos = fromVoucher.filter((item) => !usedKeys.has(itemKey(item)));

  return [...merged, ...novos];
}

/**
 * Escolhe o nº do pedido entre os vouchers anexados. Vale o primeiro
 * não-vazio; divergência vira `conflict` — quase sempre significa voucher de
 * outro cliente anexado por engano, e é melhor perguntar que adivinhar.
 */
export function pickOrderRef(refs: Array<string | null>): {
  orderRef: string | null;
  conflict: boolean;
} {
  const found = refs.filter((r): r is string => !!r && !!r.trim()).map((r) => r.trim());
  if (found.length === 0) return { orderRef: null, conflict: false };
  return {
    orderRef: found[0],
    conflict: new Set(found).size > 1,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npx vitest run src/features/acceptances/voucher-merge.test.ts
```

Esperado: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/features/acceptances/voucher-merge.ts src/features/acceptances/voucher-merge.test.ts
git commit -m "feat: mescla de itens do voucher com o rascunho da ficha"
```

---

## Task 10: Web — área de anexo no modal

**Files:**
- Create: `src/features/acceptances/components/voucher-drop-zone.tsx`
- Modify: `src/features/acceptances/components/acceptance-dialog.tsx`

- [ ] **Step 1: Criar a drop zone**

Create `src/features/acceptances/components/voucher-drop-zone.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { FileText, Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react';

export interface VoucherFileState {
  /** id local, só para o React. */
  id: string;
  filename: string;
  size: number;
  /** Preenchido quando o upload conclui. */
  url?: string;
  status: 'uploading' | 'reading' | 'done' | 'error';
  /** Quantos itens a leitura trouxe (status `done`). */
  itemCount?: number;
  /** Mensagem de erro ou aviso de PDF ilegível. */
  message?: string;
}

interface Props {
  files: VoucherFileState[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}

/**
 * Área de anexo dos vouchers: arrastar/soltar ou clicar. Só apresentação —
 * upload e leitura ficam no diálogo, que é quem conhece a conversa.
 */
export function VoucherDropZone({ files, disabled, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pickPdfs = (list: FileList | null): File[] =>
    Array.from(list ?? []).filter((f) => f.type === 'application/pdf');

  return (
    <div>
      <label className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
        Vouchers em PDF
      </label>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          const pdfs = pickPdfs(e.dataTransfer.files);
          if (pdfs.length) onAdd(pdfs);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`mt-1.5 cursor-pointer rounded-md border border-dashed px-3 py-4 text-center transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-zinc-200 hover:border-primary/50 dark:border-zinc-800'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <Plus className="h-3.5 w-3.5" />
          Arraste os PDFs aqui ou clique para escolher
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => {
            const pdfs = pickPdfs(e.target.files);
            if (pdfs.length) onAdd(pdfs);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800"
            >
              {f.status === 'uploading' || f.status === 'reading' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" />
              ) : f.status === 'error' ? (
                <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                  {f.filename}
                </p>
                <p className="truncate text-[10px] text-zinc-400">
                  {f.status === 'uploading' && 'enviando…'}
                  {f.status === 'reading' && 'lendo o voucher…'}
                  {f.status === 'done' &&
                    (f.message ?? `${f.itemCount ?? 0} ${f.itemCount === 1 ? 'item' : 'itens'}`)}
                  {f.status === 'error' && (f.message ?? 'falhou')}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onRemove(f.id)}
                disabled={disabled}
                aria-label={`Remover ${f.filename}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Plugar no diálogo — estado e handlers**

Modify `src/features/acceptances/components/acceptance-dialog.tsx`.

Nos imports, acrescente:

```tsx
import { inboxService } from '@/features/inbox/services/inbox.service';
import { acceptancesService } from '../services/acceptances.service';
import { mergeVoucherItems, pickOrderRef } from '../voucher-merge';
import { VoucherDropZone, type VoucherFileState } from './voucher-drop-zone';
```

Confira o nome real do export do serviço de inbox (`grep -n "^export const" src/features/inbox/services/inbox.service.ts`) e ajuste se for diferente.

Junto dos outros `useState`, acrescente:

```tsx
  const [files, setFiles] = useState<VoucherFileState[]>([]);
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [refConflict, setRefConflict] = useState(false);
```

No `useEffect` que roda ao abrir, acrescente a limpeza:

```tsx
    setFiles([]);
    setOrderRef(null);
    setRefConflict(false);
```

E acrescente os handlers, logo antes de `submit`:

```tsx
  /**
   * Sobe cada PDF e já dispara a leitura. Cada arquivo é independente: um que
   * falha não impede os outros, e nenhum deles bloqueia o envio — o voucher
   * vai pro cliente mesmo sem a IA ter conseguido ler.
   */
  async function addFiles(picked: File[]) {
    const entries: VoucherFileState[] = picked.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      filename: f.name,
      size: f.size,
      status: 'uploading',
    }));
    setFiles((xs) => [...xs, ...entries]);

    const patch = (id: string, next: Partial<VoucherFileState>) =>
      setFiles((xs) => xs.map((x) => (x.id === id ? { ...x, ...next } : x)));

    await Promise.all(
      picked.map(async (file, i) => {
        const { id } = entries[i];
        try {
          const upload = await inboxService.uploadMedia(file);
          patch(id, { url: upload.url, size: upload.size, status: 'reading' });

          const result = await acceptancesService.extractVoucher(upload.url);
          setItems((xs) => mergeVoucherItems(xs, result.items));
          setOrderRefFrom(result.orderRef);
          patch(id, {
            status: 'done',
            itemCount: result.items.length,
            message: result.warning,
          });
        } catch (err: any) {
          patch(id, {
            status: 'error',
            message:
              err?.response?.data?.message ??
              err?.message ??
              'não consegui enviar este arquivo',
          });
        }
      }),
    );
  }

  function setOrderRefFrom(ref: string | null) {
    if (!ref) return;
    setOrderRef((prev) => {
      const picked = pickOrderRef([prev ?? null, ref]);
      setRefConflict((had) => had || picked.conflict);
      return picked.orderRef;
    });
  }

  const removeFile = (id: string) =>
    setFiles((xs) => xs.filter((x) => x.id !== id));

  const busyWithFiles = files.some(
    (f) => f.status === 'uploading' || f.status === 'reading',
  );
```

- [ ] **Step 3: Enviar os vouchers no submit**

Modify a função `submit` no mesmo arquivo — troque a chamada `markOrderSent` e o `toast`:

```tsx
      const vouchers = files
        .filter((f) => f.status === 'done' && f.url)
        .map((f) => ({ url: f.url as string, filename: f.filename, size: f.size }));

      const result = await pipelinesService.markOrderSent(
        conversationId,
        withAcceptance
          ? {
              withAcceptance: true,
              items: clean,
              termText: term.trim() || undefined,
              vouchers,
              orderRef: orderRef ?? undefined,
            }
          : { withAcceptance: false },
      );
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });

      const failed = (result.voucherResults ?? []).filter((v) => !v.sent);
      if (failed.length > 0) {
        // Falha silenciosa aqui significa cliente sem o voucher — precisa doer.
        toast.error(
          `Aceite criado, mas ${failed.length} voucher(s) não foram enviados: ${failed
            .map((v) => v.filename)
            .join(', ')}. Use "Reenviar link" ou mande o arquivo pelo chat.`,
          { duration: 10000 },
        );
      } else {
        toast.success(
          withAcceptance
            ? 'Pedido enviado — voucher e link de aceite enviados ao cliente. 🎫'
            : 'Pedido enviado — card movido pra etapa final. 🎫',
        );
      }
      onOpenChange(false);
      onDone?.();
```

Note que `vouchers` inclui só arquivos com `status === 'done'` — arquivo que falhou no upload não tem URL para enviar.

- [ ] **Step 4: Renderizar a drop zone e o aviso**

Modify o JSX. Logo depois de `<div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">` e ANTES do bloco "Itens entregues", acrescente:

```tsx
          <VoucherDropZone
            files={files}
            disabled={saving}
            onAdd={addFiles}
            onRemove={removeFile}
          />

          {refConflict && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              Os vouchers anexados são de pedidos diferentes. Confira se algum
              arquivo é de outro cliente antes de enviar.
            </p>
          )}
```

E no botão de enviar, troque o `disabled` para também esperar os uploads:

```tsx
            disabled={saving || busyWithFiles || !hasItems}
```

- [ ] **Step 5: Verificar**

```bash
npx tsc --noEmit
npx vitest run
npm run lint
```

Esperado: sem erro de tipo, testes verdes, lint limpo.

- [ ] **Step 6: Commit**

```bash
git add src/features/acceptances
git commit -m "feat: anexo e leitura de vouchers no modal do aceite"
```

---

## Task 11: Web — vouchers na página pública

**Files:**
- Modify: `src/app/aceite/[token]/page.tsx`

- [ ] **Step 1: Bloco de vouchers**

Modify `src/app/aceite/[token]/page.tsx` — logo APÓS o bloco `{view.items.length > 0 && (...)}` (por volta da linha 243), acrescente:

```tsx
      {view.vouchers?.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-200">
          <h2 className="mb-1 text-sm font-semibold text-zinc-900">
            Seus vouchers
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            Abra e confira antes de confirmar.
          </p>
          <ul className="space-y-2">
            {view.vouchers.map((v) => (
              <li key={v.url}>
                <a
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <span aria-hidden>📄</span>
                  <span className="min-w-0 flex-1 truncate">{v.filename}</span>
                  <span className="shrink-0 text-xs text-zinc-400">abrir</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 2: Nº do pedido no cabeçalho**

Modify o mesmo arquivo. O cabeçalho do estado `PENDING` é este:

```tsx
      <header className="text-center">
        <h1 className="text-xl font-bold text-zinc-900">
          {view.organizationName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Confirmação de entrega</p>
      </header>
```

Troque por:

```tsx
      <header className="text-center">
        <h1 className="text-xl font-bold text-zinc-900">
          {view.organizationName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Confirmação de entrega
          {view.orderRef ? ` · Pedido ${view.orderRef}` : ''}
        </p>
      </header>
```

- [ ] **Step 3: Verificar**

```bash
npx tsc --noEmit
npm run build
```

Esperado: build do Next conclui sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/app/aceite
git commit -m "feat: vouchers e nº do pedido na página pública de aceite"
```

---

## Task 12: Verificação final

- [ ] **Step 1: Suíte completa da API**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/.wt-voucher-ia-api"
npm test 2>&1 | tail -20
npx tsc --noEmit
```

Esperado: toda a suíte verde (a base tinha ~1300 testes; o total deve ter subido, nenhum quebrado).

- [ ] **Step 2: Confirmar que a API realmente sobe**

Nenhum teste desta base pega erro de DI no boot — e isso já derrubou produção. Suba de verdade:

```bash
npm run build && node dist/main.js
```

Esperado: log de `Nest application successfully started`, sem `UndefinedDependencyException` nem crashloop. Encerre com Ctrl+C. Se o boot exigir banco/Redis indisponíveis localmente, registre isso e valide no deploy — mas não pule a checagem em silêncio.

- [ ] **Step 3: Suíte do Web**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/.wt-voucher-ia-web"
npx vitest run
npx tsc --noEmit
npm run build
```

Esperado: tudo verde.

- [ ] **Step 4: Abrir os PRs**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/.wt-voucher-ia-api"
git push -u fork feat/aceite-voucher-ia
gh pr create --base feat/conversation-tabs \
  --title "feat: aceite com voucher lido por IA (API)" \
  --body "$(cat <<'EOF'
Estende o Aceite de Entrega: o atendente anexa os PDFs de voucher no modal, a IA
extrai os itens e o `order-sent` manda os PDFs junto com o link de aceite.

## O que muda
- `pdf-text.util.ts` — texto do PDF via pdfjs-dist (piso de 200 caracteres úteis).
- `voucher-extractor.service.ts` — extrator grounded temp 0, espelha o da Ficha do Pedido.
- `POST acceptances/extract-voucher` — falha suave: PDF ilegível devolve aviso, nunca 500.
- `OrderAcceptance.vouchers` + `orderRef` (migration aditiva).
- `order-sent` envia cada PDF como DOCUMENT antes do link; falha de um voucher não
  impede a criação do aceite, e volta em `voucherResults` pro modal mostrar.
- Comprovante em PDF lista os vouchers com SHA-256 (calculado no backend).

## Test plan
- [x] `npm test` — suíte completa verde
- [x] `npx tsc --noEmit`
- [x] Boot real (`node dist/main.js`) sem UndefinedDependencyException
- [ ] E2E em prod: anexar voucher → cliente recebe PDF + link → assinar → comprovante com hash

Spec: `docs/superpowers/specs/2026-08-06-aceite-com-voucher-ia-design.md`
EOF
)"
```

Idem no web, ajustando o corpo para as mudanças de frontend. **Base é `feat/conversation-tabs`**, nunca `main`. Não empurre direto na branch viva.

- [ ] **Step 5: Checklist de E2E manual (após deploy)**

Rode com um voucher real, em conversa dentro da janela de 24h:

1. "Pedido enviado" → modal abre com os itens da Ficha.
2. Arrastar o PDF → chip mostra `enviando → lendo → N itens`.
3. Itens do voucher aparecem na lista, com localizador e validade.
4. Clicar em enviar → o cliente recebe o PDF **e** a mensagem do link.
5. Abrir o link no celular → vê itens, termo e o voucher para abrir.
6. Assinar → comprovante em PDF lista o voucher com o SHA-256.
7. Card mostra o selo de aceite assinado.

---

## Notas de deploy

- Roda `deploy-safe.sh`. A migration é aditiva; `migrate deploy` aplica sem downtime.
- **`pdfjs-dist` é dependência nova:** o build da imagem precisa rodar `npm ci` de verdade. Se o deploy reaproveitar `node_modules` de camada antiga, o módulo não estará lá e a extração falhará em runtime (com falha suave: chip de aviso, e o voucher é enviado do mesmo jeito).
- Nenhuma variável de ambiente nova. `APP_PUBLIC_URL` já está commitada no compose.
- Sentinelas para o `deploy-safe.sh`: `extractVoucher` (API) e `VoucherDropZone` (Web).
