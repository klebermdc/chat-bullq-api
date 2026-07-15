# Resumo de Ligação (transcrição + insight) — Design

**Data:** 2026-07-15
**Status:** Aprovado (segue pra plano/implementação)

## Objetivo

Quando uma ligação (click-to-call Sonax) termina, **baixar a gravação, transcrever e
gerar um resumo automático** (pontos-chave + próximos passos + sentimento) que aparece
em um bloco **"Resumo da ligação"** no **Card do Cliente** (pipeline) e no **Painel
Inteligente**, além de um "▶️ ver resumo" no card da ligação na timeline. Zero digitação
do atendente — a ligação vira insight no CRM sozinha.

Depende da feature de Click to Call (Fatia 1+2, já LIVE). Reusa serviços de IA existentes.

## Decisões (brainstorming 2026-07-15)
- Transcrição já funciona no projeto (chave `TRANSCRIPTION` Groq/OpenAI Whisper configurada). **Reusar.**
- Formato: **bloco dedicado "Resumo da ligação"** (não fundir no resumo geral da conversa).
- Gatilho: **automático em TODA ligação atendida com gravação** (sem mínimo de duração).
- Assíncrono: resumo aparece ~1-3 min após desligar (a gravação da Sonax é assíncrona → 0 bytes no instante do desligamento, precisa retry).

## Arquitetura (fluxo)

```
SonaxWebhookService: Call → FINISHED, answered=true, recordingUrl presente
   └─ enfileira job call-insight { callId }  (BullMQ)
        │
        ▼
  [CallInsightProcessor]
   1. baixa a gravação (recordingUrl) — RETRY/backoff até vir áudio não-vazio
      (resolve os 0 bytes da gravação assíncrona da Sonax)
   2. transcreve (Whisper via chave TRANSCRIPTION) — reusa lógica do TranscriptionService
   3. resume (LLM via chave AGENT_LLM) com prompt de LIGAÇÃO
   4. grava Call.transcript + Call.insight + insightState=READY
   5. emite realtime → card/painel atualizam sozinhos
```

Estados de `insightState`: `PENDING` (enfileirado/processando) → `READY` | `FAILED`
(erro após retries) | `SKIPPED` (não-atendida / sem gravação → não processa).

## Dados (novas colunas em `Call`)
```prisma
model Call {
  // ... campos existentes ...
  transcript   String?  @db.Text @map("transcript")
  insight      Json?    // { summary: string, nextSteps: string[], sentiment: 'positivo'|'neutro'|'negativo' }
  insightState String?  @default("PENDING") @map("insight_state")
}
```
Migração aditiva, gerada OFFLINE via `prisma migrate diff --from-schema-datamodel <baseline> --to-schema-datamodel <novo> --script` (sem DB local; a API migra no boot).

## Backend

### Reuso DRY — `TranscriptionService.transcribeBuffer`
Extrair o miolo da chamada Whisper (hoje embutido em `transcribe(messageId,...)`) para
`transcribeBuffer(organizationId, buffer, mimeType, filename): Promise<TranscriptionResult>`.
O `transcribe(message)` passa a chamar `transcribeBuffer` (comportamento inalterado; testes
existentes continuam verdes). Assim a ligação transcreve sem precisar ser uma `Message`.

### `CallInsightService.summarize(transcript): Promise<CallInsight>`
Espelhado no `ConversationSummaryService` (mesma resolução de provider `AGENT_LLM` + fetch
chat-completions), com **prompt de ligação**: "Resuma esta ligação telefônica de vendas de
viagem. Devolva JSON: { summary (2-4 frases), nextSteps (lista curta de próximos passos),
sentiment (positivo|neutro|negativo) }". Robuste contra JSON malformado (fallback).

### `CallInsightProcessor` (BullMQ, `CALL_INSIGHT_QUEUE`)
- Enfileirado por `SonaxWebhookService` quando o Call vira terminal com `answered=true` e
  `recordingUrl`. Job data: `{ callId }`. `attempts` alto + `backoff` exponencial (a
  gravação pode demorar): ex. até ~8 tentativas, backoff 30s→…→~5min.
- Passos: carrega Call → baixa `recordingUrl` (fetch server-side; se vazio/não-áudio →
  `throw` pra o BullMQ re-tentar) → `transcribeBuffer` → `CallInsightService.summarize`
  → grava `transcript`, `insight`, `insightState=READY` → emite realtime
  (`emitToConversation` `call:insight` + atualiza a Message SYSTEM do card).
- Esgotou tentativas → `insightState=FAILED` (não trava nada).
- Download: allowlist de saída — adicionar `gravacoes.sonax.cloud` se houver guard SSRF.

### Endpoint
`GET /conversations/:id/calls/latest-insight` (autenticado, escopo org) → devolve o insight
da última ligação FINISHED daquela conversa: `{ callId, status, durationSec, recordingUrl,
insightState, insight, hasTranscript }` (transcrição completa sob demanda em
`GET /calls/:callId/transcript` pra não pesar o payload).

## Frontend

### Card da ligação na timeline
Quando `insightState=READY`, o card ganha **"▶️ ver resumo"** → expande o `summary` +
`nextSteps` + sentimento, com link "ver transcrição completa" (busca a transcrição sob
demanda). Enquanto `PENDING`, mostra "⏳ gerando resumo…". Atualiza em tempo real (o handler
`message:update`/`call:insight` já reusa o realtime).

### Card do Cliente (pipeline) — bloco "Resumo da última ligação"
Consome `latest-insight` da conversa do card. Mostra: 📞 data/duração, o `summary`, os
`nextSteps` (bullets) e o sentimento 🔥/😐/⚠️. Botão "ouvir gravação" (recordingUrl) e "ver
transcrição". Só aparece se houver ligação com insight.

### Painel Inteligente — seção "Última ligação"
Mesma info do bloco acima, na coluna do Painel Inteligente da conversa aberta.

Estados na UI: processando (⏳), pronto (resumo), falhou (discreto: "resumo indisponível").

## Fora de escopo (YAGNI)
- Diarização (quem falou o quê) — Whisper devolve texto corrido; o resumo entende o contexto.
- Busca/relatório de transcrições (dado fica salvo, tela fica pra depois).
- Resumo de ligações antigas (retroativo) — só novas.

## Testes
- `transcribeBuffer` isolado (mock do axios/Whisper) + `transcribe(message)` continua verde.
- `CallInsightService.summarize` (mock LLM → parse do JSON, fallback em JSON ruim).
- `CallInsightProcessor`: baixa vazio → re-tenta (throw); baixa ok → transcreve+resume+grava
  READY + emite; não-atendida/sem gravação → SKIPPED sem baixar.
- `SonaxWebhookService` enfileira o job só quando answered+recordingUrl (não em não-atendida).
- Endpoint `latest-insight` (escopo org, sem vazamento cross-tenant).
- Frontend: card expande com resumo; bloco no Card do Cliente/Painel só aparece com insight.

## Runbook
1. Migração (transcript/insight/insight_state) — offline diff.
2. Confirmar chave `TRANSCRIPTION` (Groq) e `AGENT_LLM` já configuradas (estão).
3. Deploy api+web (rebuild; atenção ao cache BuildKit → `--no-cache` se necessário).
4. E2E: ligação atendida → desliga → ~1-3 min → resumo aparece no card/Card do Cliente/Painel.
