# Gerente geral no Telegram — design

Data: 11/11/2026 · Branch: `feat/gerente-telegram` (base `feat/conversation-tabs`)

## Objetivo

Um bot no Telegram que acompanha o atendimento da OFP no lugar de um gerente geral:
manda relatórios em horários fixos, avisa quando algo sai do normal e responde perguntas
dos gestores sobre números do atendimento.

## Decisões

| Tema | Decisão |
|---|---|
| Escopo | Só a organização OFP (`cmr2u4a5g0001s0bvjyl738k1`). Sem multi-tenant agora. |
| Quem usa | Kleber, Renata e Rafael. Cadastro por `/start <código>`; demais chats são ignorados. |
| Alcance | Só números e listas (nome do contato, vendedor, tempos). Nunca o texto das mensagens. Só leitura, sem ações. |
| IA | Claude (Anthropic API), com ferramentas fixas. Sem SQL livre. |
| Arquitetura | Módulo `manager-bot` dentro do chat-bullq-api (opção A). |
| WhatsApp | O aviso de SLA e o placar das 22h10 por WhatsApp (`slaManagerAlerts`) são desligados depois que o bot for validado. |

## Relatórios

| Relatório | Quando (BRT) | Conteúdo |
|---|---|---|
| Abertura | todo dia 09:00 | Fila sem dono, clientes esperando desde ontem (mais antigos primeiro), quem entra no expediente hoje. |
| Fechamento | todo dia 22:10 | Placar por vendedor: recebidos (novos × retorno), não começou, esperando, SLA cumprido/estourado, vendas perdidas e motivos. |
| Semanal | segunda 09:00 (depois da abertura) | Semana anterior × a outra: volumes, SLA, perdidas, ranking de vendedores. |
| Alertas | durante o expediente | (1) SLA estourado — mesmo resumo agrupado de hoje, no máximo 1 a cada 30 min; (2) fila sem dono acima do limite; (3) vendedor offline há mais de 30 min dentro do próprio expediente. Cada tipo tem trava própria de repetição. |

Os relatórios são texto montado por código (sem IA), para que número e formato sejam sempre os mesmos.
A IA entra só nas perguntas.

## Perguntas

Fluxo: mensagem chega → confere se o chat está cadastrado → manda a pergunta para a Claude com as
ferramentas abaixo → executa as chamadas pedidas (no máximo 5 rodadas) → responde em português curto,
dizendo o período consultado.

Ferramentas (todas só leitura, escopo fixo na OFP, período limitado a 90 dias):

1. `placar_do_dia(data)` — reaproveita `DailyScoreboardService`.
2. `sla_por_vendedor(inicio, fim)` — reaproveita `response-sla-metrics`.
3. `fila_agora()` — conversas sem dono abertas, com idade.
4. `esperando_agora(vendedor?)` — aba Esperando (regra do `countByTab`).
5. `nao_comecou(vendedor?)` — distribuídas que o vendedor não puxou.
6. `vendas_perdidas(inicio, fim)` — contagem por motivo e vendedor.
7. `funil(pipeline?)` — cards por etapa.
8. `presenca_equipe()` — quem está online, expediente de cada um.
9. `comparar_periodos(metrica, periodoA, periodoB)`.
10. `listar_vendedores()` — nomes e ids para a IA resolver "a Bárbara".

Regras para a IA: não inventar número; se a ferramenta falhar ou não existir para a pergunta, dizer que
não sabe. Não há memória longa: cada conversa guarda só as últimas 10 trocas (Redis, 24h).

## Componentes

```
src/modules/manager-bot/
  manager-bot.module.ts
  telegram/telegram.client.ts        envio (sendMessage, HTML, quebra em 4096 chars)
  telegram/telegram.webhook.controller.ts   POST /api/v1/manager-bot/telegram/:secret
  access/manager-bot.access.ts       cadastro /start, lista de chats permitidos
  reports/*.report.ts                abertura, fechamento, semanal (dados → texto)
  alerts/*.alert.ts                  regras + trava de repetição
  assistant/assistant.service.ts     loop da Claude com ferramentas
  assistant/tools/*.tool.ts          uma ferramenta por arquivo, schema + execução
  manager-bot.cron.ts                agenda relatórios e checagem de alertas (BullMQ)
```

Configuração em `organizations.settings.managerBot` da OFP:
`{ enabled, chats: [{ chatId, name }], linkCode, reports: {opening, closing, weekly}, alerts: {sla, queue, offline, queueThreshold} }`.

Segredos no compose da VPS: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`,
`MANAGER_BOT_MODEL` (padrão: `claude-sonnet-5-5`).

## Erros

- Ferramenta falhou: a IA recebe o erro e responde "não consegui buscar X agora".
- Claude fora do ar ou sem crédito: o bot responde que as perguntas estão indisponíveis; relatórios não dependem dela.
- Telegram fora: log com contexto; o próximo relatório sai normal (sem reenvio em cascata).
- Webhook com segredo errado ou chat não cadastrado: 200 vazio, sem resposta, com log.

## Segurança

- Webhook com segredo no caminho e header `X-Telegram-Bot-Api-Secret-Token`.
- Lista fechada de chat ids; código de cadastro de uso único, trocado a cada uso.
- Nenhum texto de mensagem de cliente sai para o Telegram nem para a Claude.

## Testes

- Unitários: cada ferramenta (escopo OFP, limite de período), cada relatório (dados fixos → texto esperado),
  regras e travas dos alertas, controle de acesso.
- Assistente com cliente da Claude simulado: chamada de ferramenta, erro de ferramenta, limite de rodadas.
- Ensaio em produção: relatórios enviados só para o Kleber por 1–2 dias antes de incluir Renata e Rafael.

## Ordem de entrega

1. PR 1: módulo, cadastro, relatórios e alertas (sem IA). Ensaio com o Kleber.
2. PR 2: perguntas com a Claude.
3. Depois de validado: desligar `slaManagerAlerts` no WhatsApp.

## Fora do escopo

Multi-tenant, ler conversas, executar ações, gráficos em imagem.
