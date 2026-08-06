# Aceite com Voucher lido por IA — Design

**Data:** 2026-08-06
**Projeto:** OFP Chat (`chat-bullq-api` / `chat-bullq-web`)
**Status:** Aprovado — pronto para o plano de implementação
**Estende:** [2026-07-26-aceite-de-entrega-design.md](2026-07-26-aceite-de-entrega-design.md) (LIVE em prod)

## Problema

Hoje, ao marcar "Pedido enviado", o atendente abre o modal do Aceite, **digita ou
corrige à mão** os itens entregues (rascunho vindo da Ficha do Pedido) e o sistema
manda o link de aceite. O voucher em PDF vai separado, num anexo à parte no chat.

São dois trabalhos manuais no momento mais corrido do atendimento: anexar o PDF e
redigitar o que já está escrito dentro dele.

**Objetivo:** o atendente joga o(s) PDF(s) de voucher dentro do próprio modal; a IA
lê e preenche os itens; um clique manda o voucher **e** o link de aceite.

## Decisões (fechadas no brainstorming)

- **O que o cliente assina:** o **mesmo termo de conferência** que já existe — só que
  com os itens vindos do voucher em vez de digitados. Não é contrato de prestação de
  serviço com cláusulas jurídicas (descartado explicitamente).
- **Quem manda o voucher:** o próprio modal, na mesma ação que cria o aceite.
- **Dados extraídos:** produto/parque, data de uso, quantidade (adultos/crianças),
  nome do titular, localizador, nº do pedido, validade e regras de uso.
  **Valor pago fica de fora** — evita expor custo da operadora num documento assinado.
- **Leitura do PDF:** extração da camada de texto (`pdfjs-dist`) + extrator grounded
  temp 0. Sem visão, sem rasterização.
- **Revisão:** o atendente **sempre** confere antes de enviar. A IA preenche rascunho.
- **Extração é síncrona** (sem fila BullMQ): são poucos segundos e o atendente está
  olhando o modal.

## Princípios inegociáveis do desenho

1. **Falha da IA nunca vira falha da entrega.** Se a extração falhar, o PDF vai pro
   cliente do mesmo jeito e o atendente digita os itens como faz hoje.
2. **A IA nunca envia sozinha.** Ela preenche; quem confirma é o atendente.
3. **Nada falha em silêncio.** Todo erro de upload, leitura ou envio aparece no modal.

## Fluxo ponta-a-ponta

1. Atendente clica **"Pedido enviado"** → modal abre e puxa o rascunho da Ficha do
   Pedido (comportamento atual, preservado).
2. **Nova área de anexo** no topo: arrasta ou seleciona 1..N PDFs. Cada arquivo vira
   um chip com nome e status: `enviando → lendo → ✅ 3 itens` ou `⚠️ não consegui ler`.
3. Cada upload dispara a leitura automaticamente. Os itens extraídos entram **na mesma
   lista editável que já existe**, marcados com ícone de voucher (origem visível).

   **Regra de deduplicação** (aplicada no web, ao mesclar): dois itens são o mesmo
   quando `description` normalizada (minúscula, sem acento, espaços colapsados) **e**
   `date` coincidem. Vence o item do voucher — ele tem `ref`, `note` e data confiáveis;
   o da Ficha é o que o cliente pediu, não o que foi entregue.

   **`orderRef` com múltiplos PDFs:** vale o primeiro valor não-vazio. Se dois vouchers
   trouxerem números diferentes, o modal avisa ("vouchers de pedidos diferentes") e
   deixa o atendente escolher — provavelmente ele anexou o PDF de outro cliente.
4. Atendente confere e edita. Um clique em **"Enviar voucher + aceite"**:
   - manda cada PDF como documento no WhatsApp;
   - cria o `OrderAcceptance` (snapshot de itens + termo + vouchers + `orderRef`);
   - manda a mensagem com o link `.../aceite/<token>`;
   - move o card (comportamento atual, preservado).
5. Página `/aceite/<token>`: itens + termo + **vouchers anexados pra abrir/baixar**.
   O cliente assina com o documento à frente — bem mais forte numa disputa do que
   assinar uma lista digitada.
6. Comprovante em PDF passa a listar os vouchers entregues por **nome + SHA-256**.
   Não embute os arquivos (evita comprovante gigante); o hash prova que é aquele arquivo.

**Escape hatch preservado:** "só marcar enviado, sem aceite" continua funcionando.

## Arquitetura

### 1. Upload — nada novo

`POST messages/uploads/media` já aceita `application/pdf`
(`uploads.service.ts`, `ALLOWED_MEDIA_MIME`) e devolve
`{ url, mimeType, size, filename }`, persistindo no MinIO. O modal reusa o mesmo
caminho do anexo do compositor. Nenhum encanamento de upload novo.

### 2. Leitura — dois arquivos pequenos no módulo `acceptances`

- **`pdf-text.util.ts`** — buffer → texto via `pdfjs-dist` (**única dependência nova**;
  pura JS, sem binário nativo). **Piso mínimo: 200 caracteres úteis** (após colapsar
  espaços) no documento inteiro. Abaixo disso devolve vazio, em vez de mandar ruído
  pro LLM e receber invenção de volta.
- **`voucher-extractor.service.ts`** — texto → `LlmService.complete` com
  `SAKANA_SIMPLE_MODEL`, `temperature: 0`, proibido inventar, saída JSON. Clone do
  padrão do `OrderExtractorService`, inclusive o parse tolerante que descarta blocos
  `<think>...</think>`.

### 3. Dados — migration aditiva

Em `OrderAcceptance`:

| Campo | Tipo | Nota |
|---|---|---|
| `vouchers` | `Json?` | `[{ url, filename, size, sha256 }]` |
| `orderRef` | `String?` | nº do pedido, exibido no cabeçalho da página pública |

`AcceptanceItem` (dentro de `items`, que já é `Json` — **sem migration**) ganha:

| Campo | Tipo | Nota |
|---|---|---|
| `ref` | `string?` | localizador / nº de confirmação da operadora |
| `note` | `string?` | **já existe** — recebe validade e regras de uso |

O **SHA-256 é calculado no backend**, lendo o arquivo do storage na criação do aceite.
Hash mandado pelo navegador não vale como prova.

### 4. Endpoints

Autenticado (atendente):

- **`POST acceptances/extract-voucher`** (novo, org-scoped) — body `{ mediaUrl }`,
  devolve `{ items, orderRef?, warning? }`.
  **Falha suave:** sem texto legível → `items: []` + `warning`, nunca 500.
- **`POST conversations/:conversationId/order-sent`** (estendido) — body ganha
  `vouchers: [{ url, filename, size }]`. O backend envia cada PDF via
  `MessagesService.send` com `content.mediaUrl`, calcula os hashes, cria o aceite e
  manda o link.

Público (`@Public()`):

- **`GET public/acceptances/:token`** — `PublicAcceptanceView` passa a incluir
  `vouchers` e `orderRef`.

### 5. Web

- `acceptance-dialog.tsx` — área de drop/seleção de PDFs, chips de status por arquivo,
  mescla dos itens extraídos no rascunho existente, relatório do que foi/não foi enviado.
- `/aceite/[token]/page.tsx` — bloco de vouchers pra baixar + `orderRef` no cabeçalho.

## Erros

| O que acontece | Como o sistema reage |
|---|---|
| Upload falha (rede, tamanho) | Chip vermelho; os outros arquivos continuam |
| PDF sem camada de texto (escaneado) | Chip "não consegui ler — confira à mão"; **o PDF ainda é enviado** |
| LLM fora do ar ou devolve lixo | Idem acima — extração é bônus, não bloqueio |
| Envio de um voucher falha (janela 24h) | Modal lista o que foi e o que não foi; aceite é criado; "Reenviar link" cobre a retomada |
| Sem Ficha do Pedido e sem PDF legível | Modal abre vazio e editável, como hoje |

## Riscos

- **Janela de 24h do canal oficial (Meta):** fora da janela, tanto o PDF quanto o link
  falham (gate `computeWhatsappWindow`). Risco já documentado no spec original e **não
  resolvido aqui** — a mudança é que o modal passa a dizer claramente o que não foi
  enviado, em vez de reportar sucesso com o cliente sem receber nada. HSM fica pra
  fatia futura.
- **Formato de voucher desconhecido:** o extrator é grounded (proibido inventar), então
  um layout novo tende a devolver menos itens, não itens errados. O atendente completa.
- **Dependência nova (`pdfjs-dist`):** pura JS, sem binário — não muda a imagem Docker.

## Testes

- **Unit:** extração de texto de PDF de voucher real (fixture); piso de 200 caracteres
  retornando vazio; parse tolerante do JSON com `<think>`; cálculo do SHA-256; mescla
  de itens do voucher com o rascunho da Ficha (dedup por descrição normalizada + data,
  voucher vencendo); `orderRef` divergente entre dois PDFs gerando aviso.
- **Unit:** `order-sent` estendido continua movendo o card com `withAcceptance=false`;
  falha no envio de um voucher não impede a criação do aceite.
- **Integração:** upload → extract → order-sent → página pública lista `vouchers` e
  `orderRef` → assinatura gera comprovante com nome + hash.

## Fora de escopo (YAGNI)

- **Gatilho automático pelo Gmail** — é o
  [envio automático de vouchers](2026-07-20-envio-automatico-vouchers-design.md), que
  poderá reusar este mesmo extrator quando for implementado.
- **Fallback de visão pra PDF escaneado** — aditivo depois, se aparecer o caso.
- **HSM pra entregar fora da janela de 24h.**
- **Cruzar o voucher com a Ficha do Pedido e alertar divergência** — o motor
  (`DivergenceService`) já existe; ligar os dois é outra fatia.
- **Contrato com cláusulas jurídicas** — descartado na decisão de escopo.
- **Valor pago no documento** — descartado por exposição de custo.
