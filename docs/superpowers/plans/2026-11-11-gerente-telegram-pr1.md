# Gerente no Telegram — PR 1 (relatórios e alertas, sem IA)

> Spec: `docs/superpowers/specs/2026-11-11-gerente-telegram-design.md`. Execução inline, TDD por tarefa.

**Goal:** bot do Telegram que manda abertura (09:00), fechamento (22:10), semanal (seg 09:05) e alertas
(SLA, fila, vendedor offline no expediente) aos gestores cadastrados da OFP.

**Architecture:** módulo `src/modules/manager-bot` no mesmo molde do `SlaManagerAlertsModule`: tique BullMQ de
5 min, trava no Redis (SET NX PX), config em `organizations.settings.managerBot`. Números vêm de serviços que já
existem: `DailyScoreboardService`, `ManagerAlertsRepository` (esperas/SLA), `TeamPresenceService`. Texto montado
por funções puras (HTML do Telegram). Webhook público com segredo para o cadastro `/start <código>` e os
comandos `/placar` e `/manha`.

**Tech:** NestJS 11, Prisma, BullMQ, Jest, `fetch` nativo para a Bot API.

## Arquivos

| Arquivo | Papel |
|---|---|
| `manager-bot.types.ts` | constantes (fila, job, padrão do cron, token da trava), tipos de relatório |
| `manager-bot.config.ts` (+spec) | lê e valida `settings.managerBot` |
| `manager-bot.rules.ts` (+spec) | horários: relatório devido, segunda-feira, limites das semanas |
| `manager-bot.format.ts` (+spec) | escape HTML, duração, hora local, quebra em pedaços de 4000 |
| `reports/opening.report.ts` (+spec) | texto da abertura |
| `reports/closing.report.ts` (+spec) | texto do fechamento |
| `reports/weekly.report.ts` (+spec) | texto do semanal |
| `alerts/manager-bot.alerts.ts` (+spec) | regras e texto dos 3 alertas |
| `telegram/telegram.client.ts` (+spec) | `sendMessage` com quebra e timeout |
| `manager-bot.throttle.ts` | trava genérica `claim(key, ttlMs)` |
| `manager-bot.repository.ts` | contagens da semana, vendas perdidas, gravar chat cadastrado |
| `manager-bot.reports.service.ts` | coleta dados e monta cada relatório |
| `manager-bot.service.ts` (+spec) | tique: decide o que sai, trava, envia, reporta falha |
| `manager-bot.access.ts` (+spec) | trata update do Telegram: cadastro e comandos |
| `manager-bot.controller.ts` | webhook público + `POST /manager-bot/test` (OWNER/ADMIN) |
| `manager-bot.cron.ts`, `manager-bot.processor.ts`, `manager-bot.module.ts` | agenda e worker |

Alterações: `app.module.ts` (registrar), `manager-alerts.module.ts` e `team-presence.module.ts` (exportar
repositório/serviço), `error-codes.ts` (`MANAGER_BOT_FAILED`), `.env.example`.

## Tarefas

1. **Config** — testes: ausente → off sem motivo; `enabled:false` → off; chat inválido → off com motivo;
   padrões (09:00, 22:10, 30, 30, 10, 30); `chats` vazio é válido (fase de cadastro).
2. **Regras de horário** — testes: devido dentro de 60 min após o horário e não antes; segunda no fuso de SP;
   semana anterior = segunda 00:00 até segunda 00:00 local.
3. **Formatação** — testes: escape de `<>&`; "2h05", "45 min"; quebra respeita linhas e limite.
4. **Relatórios** — testes com dados fixos: abertura (fila, esperando desde ontem com limite de 10 linhas,
   equipe no expediente / entra depois); fechamento (só vendedores com movimento, SLA por vendedor, perdidas por
   motivo, dia sem movimento); semanal (variação com seta e %; sem dado → "–").
5. **Alertas** — testes: fila só acima do limite; offline só com expediente configurado, dentro do horário e
   inativo ≥ N min; texto do SLA lista até 10.
6. **Cliente Telegram** — testes com `fetch` simulado: sem token → erro sem chamada; quebra em várias
   mensagens; resposta `ok:false` vira erro com descrição.
7. **Serviço do tique** — testes com dublês: sem chats não envia; relatório devido + trava ganha → envia a todos;
   trava perdida → não envia; silêncio (22:30–08:00) bloqueia alertas; falha de um passo não para os outros.
8. **Acesso** — testes: código certo cadastra e troca o código; código errado ignora; chat cadastrado com
   `/placar` recebe o fechamento parcial; chat estranho sem código não recebe nada.
9. **Controller, cron, módulo** — webhook confere segredo do caminho e do header (`timingSafeEqual`);
   registro no `AppModule`; `tsc` e testes do módulo verdes.
10. **Ops (Kleber)** — BotFather → `TELEGRAM_BOT_TOKEN`; gerar `TELEGRAM_WEBHOOK_SECRET`; compose; deploy;
    `setWebhook`; gravar `settings.managerBot` com `enabled:true, chats:[], linkCode`; Kleber manda `/start`;
    ensaio 1–2 dias; cadastrar Renata e Rafael; desligar `slaManagerAlerts`.
