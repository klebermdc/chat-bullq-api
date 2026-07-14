# Design — Filtros no Pipeline de Vendas

**Data:** 2026-07-13
**Autor:** Claude + contato@orlandofastpass.com.br
**Status:** Aprovado (aguardando plano de implementação)

## Contexto e objetivo

A página do board do Pipeline (`/pipelines/[id]`, Kanban) hoje mostra **todos os cards** de um pipeline agrupados por etapa, sem nenhum filtro. Com o volume de leads crescendo, o time precisa **fatiar a visão** do funil por vendedor, por período e por outros critérios de negócio.

Pedido do usuário: "quero filtros na página do Pipeline de vendas — por vendedor, por mês, entre outros" + "no card você deve colocar a data da entrada do lead".

## Escopo

1. **Barra de filtros** no topo do board (abaixo do cabeçalho existente).
2. **Selo de data de entrada do lead** em cada card do Kanban.

Fora de escopo: filtros na lista de pipelines (`/pipelines`), salvar filtros como "views", filtros na Inbox (já existem), relatórios (já existem em `/relatorios`).

## Os 7 filtros

Todos combinam em modo **E** (AND). Botão **"Limpar filtros"** reseta tudo.

| # | Filtro | Semântica | Fonte do dado | Camada |
|---|--------|-----------|---------------|--------|
| 1 | **Vendedor** | Atendente responsável pelo card | `card.conversation.assignedTo` com fallback `card.assignedTo` | Frontend |
| 2 | **Mês de entrada do lead** | Mês/ano em que o card foi criado | `card.createdAt` | Frontend |
| 3 | **Mês da viagem** | Mês/ano da viagem do cliente | `startDate` da **proposta mais recente** do contato do card | Backend (novo campo `travelStartDate`) |
| 4 | **Etapa** | Etapa do funil | `card.stageId` | Frontend |
| 5 | **Status** | Aberto / Ganho / Perdido | `card.status` (OPEN/WON/LOST) | Frontend |
| 6 | **Faixa de valor** | Valor mín. e máx. do negócio | `card.value` | Frontend |
| 7 | **Busca por nome** | Texto livre sobre nome do cliente/título | `card.contact.name` / `card.title` | Frontend |

### Filtros de mês
- São **seletores de um único mês** (dropdown "Julho/2026"), não intervalos.
- A lista de meses disponíveis é derivada dos dados presentes no board (só aparecem meses que têm card), evitando meses vazios.

### Regra do "mês da viagem"
- Um contato pode ter **N propostas**; usa-se a **mais recente** (`createdAt` desc) como a viagem "vigente" daquele card.
- Cards **sem proposta** têm `travelStartDate = null` → quando o filtro de mês da viagem está ativo, esses cards **não aparecem** (comportamento esperado e documentado na UI via tooltip/placeholder).

### Efeito nas colunas
- Filtrar **esconde os cards** que não batem; as colunas do Kanban permanecem visíveis.
- O **contador e a soma de valor de cada coluna** passam a refletir apenas os cards visíveis (filtrados).

## Selo de data de entrada no card

- No `KanbanCard`, exibir a data de criação do card (`card.createdAt`) como um selo discreto, ex.: **"Entrou 05/07"**.
- Formato curto (dd/mm); sem alterar o layout geral do card.

## Design técnico

### Frontend (`chat-bullq-web`)
- Novo componente **`pipeline-filter-bar.tsx`** em `src/features/pipelines/components/`.
- Estado de filtro elevado ao `KanbanBoard` (ou à página do board) — um objeto `PipelineFilter`.
- **Filtragem em memória** sobre `board.cards` (que já vem inteiro): uma função pura `applyFilters(cards, filter)` reaproveitada por coluna. **Sem novas requisições** — resposta instantânea.
- Contadores/soma por coluna calculados sobre a lista já filtrada.
- Ajuste no `KanbanCard` para o selo de data de entrada.
- Sem novas dependências.

### Backend (`chat-bullq-api`) — apenas para o "mês da viagem"
- `PipelinesService.getBoard` passa a, após carregar os cards, buscar em **uma query** a `startDate` da proposta mais recente por `contactId` (dos contatos presentes no board) e anexar `travelStartDate` (ISO string ou null) em cada card retornado.
- Implementação: coletar `contactId`s distintos → `proposal.findMany({ where: { organizationId, contactId: { in } }, orderBy: { createdAt: 'desc' } })` e reduzir para "primeira por contato" (mais recente), ou query equivalente. Mantém escopo por `organizationId`.
- **Sem migração** — a tabela `proposals` já existe.
- Tipo `CardSummary` (web) e o retorno do board ganham o campo opcional `travelStartDate: string | null`.

### RBAC / multitenancy
- Sem mudança de regra: o board já é escopado por `organizationId` e a visibilidade por papel (agente) permanece a existente. O filtro de "vendedor" é **conveniência visual**, não controle de acesso.

## Testes
- **Backend:** teste de `getBoard` cobrindo `travelStartDate` — (a) contato com múltiplas propostas retorna a `startDate` da mais recente; (b) card sem contato/sem proposta retorna `null`; (c) isolamento por org.
- **Frontend:** `applyFilters` como função pura testável (unidade) cobrindo cada filtro e a combinação; `tsc --noEmit` limpo nos dois repos.

## Deploy
- Rebuild **api + web** no VPS (branch viva `feat/conversation-tabs`).
- **Sem migração.**
- Validação: abrir `/pipelines/[id]`, aplicar cada filtro, conferir contadores das colunas e o selo de data no card.

## Pegadinhas conhecidas
- Base do trabalho deve partir da **`feat/conversation-tabs` atualizada** (o worktree local estava na branch velha `feat/crm-reports-conversations`).
- Deploy via **PR + branch própria**, não push direto na branch viva (sessão paralela causa divergência).
