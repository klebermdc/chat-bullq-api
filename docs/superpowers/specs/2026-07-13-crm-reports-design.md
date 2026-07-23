# Relatórios do CRM + Gerador de Relatórios — Design

Data: 2026-07-13
Repos: `chat-bullq-api` + `chat-bullq-web`
Branch base: `feat/conversation-tabs`

## Objetivo

Uma página nova **`/relatorios`** ("Relatórios") que gera relatórios sobre os dados
do **próprio CRM** — Deals (funil), Leads (contatos) e Conversas (atendimento) —
com filtros ricos, métricas agregadas, tabela detalhada e exportação CSV.

Não confundir com **`/relatorios-vendas`** (que já existe e cobre pedidos do OFP Hub,
uma fonte externa). Esta é sobre os dados internos do CRM.

## Decisões (confirmadas com o usuário)

1. **Fontes:** Deals/Funil, Leads/Contatos, Conversas — as três, num seletor de fonte.
2. **Saída:** métricas (cards no topo) **+** tabela detalhada exportável.
3. **Local:** página nova `/relatorios`, separada da de Vendas.
4. **Salvar:** não por enquanto — ad-hoc (filtra → vê → exporta). Salvar vira fatia futura.
5. **Export:** CSV (abre no Excel).
6. **RBAC:** ADMIN/OWNER vê a org inteira; **AGENTE vê só o que é dele** (deals/conversas/
   leads onde ele é o atendente atribuído). Mesma filosofia do resto do sistema.
7. **Entrega:** por fatias — **Fatia 1 = Deals**, deploya e valida, depois Leads e Conversas.

## Arquitetura

### Frontend — feature `crm-reports` (`chat-bullq-web/src/features/crm-reports/`)
- Página `/relatorios` com **seletor de fonte** (Deals · Leads · Conversas).
- Componentes reutilizáveis entre fontes:
  - `ReportFilterBar` — período (presets Hoje/7d/30d/Mês/Personalizado) + filtros da fonte.
  - `MetricsRow` — cards de KPI (reusa estilo do `StatCard` de reports).
  - `ReportTable` — tabela paginada com colunas da fonte.
  - `ExportButton` — baixa CSV do resultado filtrado (sem paginação).
- Um service por fonte, ou um `crmReportsService` com um método por fonte.

### Backend — módulo `crm-reports` (`chat-bullq-api/src/modules/crm-reports/`)
- 1 endpoint de relatório por fonte, cada um retornando `{ metrics, rows, page }`:
  - `GET /crm-reports/deals`
  - `GET /crm-reports/leads`
  - `GET /crm-reports/conversations`
- Endpoint de export: `GET /crm-reports/:source/export.csv` (mesmos filtros, streaming CSV,
  sem paginação, cap de linhas — ex. 10k — com aviso se truncar).
- (Opcional) `GET /crm-reports/facets` pra popular selects (atendentes, pipelines, etapas,
  canais) — ou reusar endpoints existentes de membros/pipelines/channels no front.
- Guards: `JwtAuthGuard, OrgGuard, RolesGuard`. Scoping por `role` + `userId`
  (`@CurrentUser('id')`, `@CurrentUserRole()`). Sem migração — lê de Card/Contact/Conversation.

### RBAC (regra de scoping)
- `ADMIN`/`OWNER`: sem filtro de dono (org inteira).
- `AGENT`: adiciona `WHERE` de propriedade:
  - Deals: `card.assignedToId = me OR card.conversation.assignedToId = me`.
  - Conversas: `conversation.assignedToId = me`.
  - Leads: contatos com alguma conversa/deal atribuído a `me`.

## Fatia 1 — Deals/Funil (esta entrega)

### Filtros
- **Período** (por `createdAt` do card; toggle "por data de fechamento" usa `closedAt`).
- **Pipeline** (obrigatório escolher, default = pipeline padrão).
- **Etapa** (stageId, opcional, multi).
- **Status**: aberto / ganho / perdido (CardStatus OPEN/WON/LOST).
- **Atendente** (assignedTo — card ou conversa).
- **Faixa de valor** (min/max sobre `value`).
- **Tem proposta?** (existe Proposal pro contato/conversa) — sim/não/qualquer.

### Métricas (topo)
- Nº de deals (no filtro)
- Valor total (soma `value`)
- Ganhos: nº + R$
- Perdidos: nº + R$
- **Taxa de conversão** = ganhos ÷ (ganhos + perdidos)
- Ticket médio dos ganhos

### Tabela (colunas)
Cliente (contato) · Pipeline · Etapa · Status · Valor · Atendente · Criado em ·
Fechado em · Motivo (closedReason). Paginada (ex. 25/pág), ordenável por valor/data.

### Export CSV
Mesmas colunas da tabela, todas as linhas do filtro (cap 10k), download direto.

### Testes (Fatia 1)
- Backend TDD: scoping RBAC (agente vê só os seus), agregações (conversão, totais),
  filtros combinados, cap do export. 
- tsc/build verdes nos dois repos. E2E manual na página após deploy.

## Fatias seguintes (fora desta entrega, mesma página)

- **Fatia 2 — Leads/Contatos:** filtros (origem via tags, canal, atendente, tag, tem
  proposta?, temperatura, tem deal?), métricas (novos no período, % com proposta/deal,
  breakdown por origem), tabela de contatos. Origem do lead depende de tags/metadata —
  mapear na fatia.
- **Fatia 3 — Conversas:** filtros (status, canal, atendente, tag, reabertas?, 1ª
  resposta), métricas (abertas vs finalizadas, tempo médio de 1ª resposta via
  `firstResponseAt`, reaberturas), tabela de conversas.

## Fora de escopo (YAGNI)
- Relatórios salvos / agendados / por e-mail.
- Excel (.xlsx) nativo — CSV cobre o caso.
- Gráficos avançados na Fatia 1 (métricas em cards bastam; charts podem entrar depois).
- Origem do lead nos Deals (sem campo dedicado; entra com o mapeamento da Fatia 2).
