# Cliente oculto — Parte 1: marcação, avaliação e página

Data: 2026-11-13 · Status: desenho aprovado em conversa, aguardando revisão do documento

## Objetivo

Avaliar e comparar vendedores com visitas de um "cliente oculto" que entra pelo WhatsApp
como um lead comum. A Parte 1 é tudo o que fica no Sendtur: marcar os números do cliente
oculto, acompanhar cada visita, avaliar o vendedor por rubrica e mostrar o resultado a
quem pode ver. As visitas da Parte 1 são feitas à mão (chip de teste num celular).

Fora do escopo (Parte 2): robô que conversa sozinho (Baileys + números virtuais),
personas geradas, agendamento de visitas.

## Decisões

| Tema | Decisão |
|---|---|
| Objetivo | Comparar vendedores (não treino, não teste do funil) |
| Entrada | Fluxo normal: Aline → distribuição → vendedor. Comparação sai do acúmulo de visitas |
| Números | Parte 2 usará números virtuais, um por visita. Parte 1: chip de teste do Kleber |
| Quem vê | Só os e-mails em `settings.mysteryShopper.viewerEmails` — inicialmente só `admin@orlandofastpass.com.br` |
| Vendedor vê o resultado? | Não |
| Telegram | Só os chats em `settings.mysteryShopper.telegramChatIds`; lista vazia = não envia |

Configuração fica em `Organization.settings` (nada fixo da OFP no código).

## 1. Dados e ciclo da visita

### Marcação do contato

- `Contact.isMysteryShopper Boolean @default(false) @map("is_mystery_shopper")`, com índice
  `(organization_id, is_mystery_shopper)`.
- Marcado pela aba **Números** da página: o viewer informa o telefone (normalizado como no
  restante do sistema); o contato existente é marcado ou um novo é criado já marcado.
- Desmarcar vale só para visitas futuras; visitas antigas permanecem.

### Sigilo

- O campo **nunca** sai em resposta da API nem em evento em tempo real para quem não é viewer.
  Implementação: retirar o campo no ponto de serialização de contato (select explícito /
  omissão), não confiar em filtro no front.
- Nenhuma etiqueta, nome ou sinal visual no contato.

### Visita

Tabela `mystery_shopper_visits`:

| Campo | Tipo | Nota |
|---|---|---|
| id | cuid | |
| organization_id | FK | |
| contact_id | FK | |
| conversation_id | FK, único | uma visita por conversa |
| seller_user_id | FK nullable | dono da conversa quando a visita fecha |
| scenario | text nullable | texto livre ("família de 4, julho, objeção de preço") |
| status | enum | `OPEN`, `EVALUATING`, `DONE`, `FAILED`, `DISCARDED` |
| last_shopper_message_at | timestamptz | base das 72h |
| closed_at, evaluated_at | timestamptz nullable | |
| metrics | jsonb | métricas calculadas por código |
| scores | jsonb | nota por critério + trecho de prova |
| total_score | int nullable | 0–100 |
| summary | jsonb | resumo, 2 pontos fortes, 2 a melhorar |
| error | text nullable | motivo do FAILED |
| cost_usd | numeric nullable | |
| created_at, updated_at | | |

### Ciclo

1. Mensagem INBOUND de contato marcado em conversa sem visita → cria visita `OPEN`.
   Mensagens seguintes do cliente atualizam `last_shopper_message_at`.
2. Rotina periódica (mesmo padrão das rotinas existentes, ex.: a cada 15 min): visitas `OPEN`
   com `last_shopper_message_at` há mais de **72h** → `EVALUATING`.
3. Viewer pode forçar: **Encerrar e avaliar agora**.
4. Avaliador roda → `DONE` (ou `FAILED` com `error`). **Reavaliar** volta para `EVALUATING`.
5. **Descartar** → `DISCARDED`, fora do ranking.

Se o cliente oculto escrever de novo depois de `DONE` na mesma conversa, não reabre: a visita
fica como está (nova visita = nova conversa).

### Exclusões

Contatos marcados ficam **fora** de:
- Diário do atendente (obrigatório — senão o vendedor recebe feedback da visita);
- Placar do dia (`daily-scoreboard`);
- Gerente no Telegram (relatórios e perguntas);
- Leads do Marketing.

Continuam **valendo**: SLA e alertas, Aline, cadência, roteamento (fazem parte do realismo).
Dashboard e relatórios do CRM ficam sem filtro na Parte 1 (poucas visitas, ruído desprezível).

## 2. Rubrica e avaliador

### Critérios

Skills da categoria `cliente-oculto`, criadas com o padrão abaixo na primeira avaliação e
editáveis na tela de Skills (mesmo mecanismo do Diário). Escala por critério:
**0 = não fez, 1 = fez em parte, 2 = fez bem**, sempre com trecho da conversa como prova.
Nota total = soma / (2 × nº de critérios) × 100.

| # | Critério | Quem mede |
|---|---|---|
| 1 | Tempo da 1ª resposta humana após o handoff | Código (minutos → 0/1/2 por faixas configuráveis; padrão ≤15 min = 2, ≤60 min = 1) |
| 2 | Descoberta (datas, pessoas, idades, parques, orçamento) | IA |
| 3 | Cotação/proposta adequada ao pedido | IA + código (houve proposta/cotação?) |
| 4 | Informação correta (regras de produto do Diário) | IA |
| 5 | Tratamento da objeção do cenário | IA |
| 6 | Tentativa de fechamento / próximo passo claro | IA |
| 7 | Follow-up em até 72h após a última mensagem do cliente | Código (houve? quando?) + IA (qualidade) |
| 8 | Tom e cordialidade | IA |

Sem cenário preenchido, o critério 5 é avaliado só se houver objeção na conversa; senão sai
do cálculo.

### O que é julgado

Só mensagens humanas do vendedor (OUTBOUND com `sender_id` humano, não SYSTEM/automáticas).
Mensagens da Aline e automáticas entram como contexto, marcadas, sem nota.

### Métricas por código (`metrics`)

- `firstHumanReplyMinutes` (a partir do handoff = primeiro log ASSIGNED da conversa, o mesmo
  que o placar usa; sem log, a partir da 1ª mensagem do cliente)
- `humanMessages`, `followUps` (mensagens humanas após `last_shopper_message_at`),
  `firstFollowUpHours`, `proposalSent` (boolean)

### Execução

- IA da organização (MiniMax hoje), reaproveitando as proteções do Diário: `stripThinkBlocks`,
  retry quando o JSON vem ilegível, trava de idioma, nome do cliente em vez de apelidos.
- Uma chamada por visita (conversa inteira cabe no contexto; sem blocos).
- Falha → `FAILED`; nunca sobrescreve uma avaliação `DONE` (reavaliação grava só se sucesso).

## 3. Página e aviso

### Acesso

- `GET /mystery-shopper/access` → `{ allowed: boolean }` para o usuário logado
  (e-mail ∈ `viewerEmails`, sem diferenciar maiúsculas).
- Todos os demais endpoints do módulo: **404** para quem não é viewer (inclusive ADMIN/OWNER).
- Web: item "Cliente oculto" **só aparece no menu do viewer**; rota direta mostra "página não
  encontrada" para os demais.

### Página `/cliente-oculto`

1. **Visitas** (padrão): lista com data, vendedor, cenário, status, nota; abertas no topo com
   "fecha em Xh". Detalhe: conversa só leitura à esquerda (Aline/automáticas esmaecidas),
   notas com trecho de prova à direita (clicar leva à mensagem), fortes/melhorar, resumo.
   Ações: Editar cenário, Encerrar e avaliar agora, Reavaliar, Descartar.
2. **Ranking**: vendedor, média em 90 dias, nº de visitas (aviso "amostra pequena" com 1–2),
   média por critério. Só visitas `DONE`.
3. **Números**: listar, cadastrar (telefone + apelido), remover.

### Telegram

Ao chegar em `DONE`, envia pelo bot do Gerente para cada chat de `telegramChatIds`:
"Visita do cliente oculto avaliada: <vendedor>, <nota>/100. Ponto fraco: <1 linha>." + link.
Lista vazia ou bot desligado = não envia, sem erro.

## 4. Testes, riscos e implantação

### Testes (API)

- Ciclo: INBOUND de contato marcado cria visita; 72h → avaliação; descartar tira do ranking;
  mensagem após DONE não reabre.
- Métricas: 1ª resposta ignora Aline/automáticas; follow-up só humano após a última do cliente.
- Avaliador: think removido, retry de JSON, FAILED sem apagar DONE.
- **Sigilo**: viewer 200; outro ADMIN/OWNER 404; AGENT recebe contato sem o campo na API e
  nos eventos em tempo real.
- Exclusões: Diário, placar, Gerente e Marketing ignoram contatos marcados.

### Testes (web)

Menu visível só com `allowed: true`; página com as 3 abas.

### Teste real

Chip do Kleber escreve à OFP → vendedor atende → "Encerrar e avaliar" → conferir nota.

### Riscos

- Vazamento do campo para o vendedor → testes de sigilo dedicados.
- Chip reaproveitado volta ao mesmo vendedor com histórico (aceitável para teste; avaliação
  real usa um número por visita na Parte 2).
- Aline/cadência agem normalmente sobre o cliente oculto (esperado).

### Implantação

1. Migração (coluna em `contacts` + tabela + enum).
2. Deploy da API, depois do web.
3. SQL: `settings.mysteryShopper = { viewerEmails: ["admin@orlandofastpass.com.br"], telegramChatIds: [] }`
   na org OFP.
4. Cadastrar o chip de teste na aba Números.
