# Resumo de Ligação (transcrição + insight) — Plano

> **For agentic workers:** subagent-driven-development. Base: `fork/feat/conversation-tabs`.

**Goal:** Ligação atendida → job baixa gravação (retry) → transcreve (Whisper) → resume (LLM) → resumo no card da timeline + Card do Cliente + Painel Inteligente.

Spec: `docs/superpowers/specs/2026-07-15-call-insight-transcricao-resumo-design.md`.

## File Structure (backend — chat-bullq-api)
- `prisma/schema.prisma` — MODIFY: Call.transcript/insight/insightState + migração.
- `src/modules/messaging/messages/transcription.service.ts` — MODIFY: extrair `transcribeBuffer(orgId, buffer, mime, filename)`; `transcribe()` chama ele.
- `src/modules/calls/call-insight.service.ts` (+spec) — CREATE: `summarize(orgId, transcript)` (espelha ConversationSummaryService, prompt de ligação).
- `src/modules/calls/call-insight.constants.ts` — CREATE: `CALL_INSIGHT_QUEUE`.
- `src/modules/calls/call-insight.processor.ts` (+spec) — CREATE: job (download+retry, transcribe, summarize, grava, emite).
- `src/modules/calls/recording-downloader.ts` (+spec) — CREATE: baixa recordingUrl, valida não-vazio/áudio, lança pra retry.
- `src/modules/calls/sonax-webhook.service.ts` — MODIFY: enfileira job quando answered+recordingUrl+terminal.
- `src/modules/calls/calls.controller.ts` — MODIFY: `GET conversations/:id/calls/latest-insight` + `GET calls/:callId/transcript`.
- `src/modules/calls/calls.service.ts` — MODIFY: `getLatestInsight(convId, orgId)`, `getTranscript(callId, orgId)`.
- `src/modules/calls/calls.module.ts` — MODIFY: registerQueue(CALL_INSIGHT_QUEUE), providers (CallInsightService, RecordingDownloader, CallInsightProcessor), import MessagingModule (pro TranscriptionService) ou providenciar.

## File Structure (frontend — chat-bullq-web)
- `src/features/inbox/components/call-card.tsx` — MODIFY: "▶️ ver resumo" (expande insight) + "⏳ gerando resumo".
- `src/features/inbox/services/calls.service.ts` — MODIFY: `getLatestInsight(convId)`, `getTranscript(callId)`.
- Card do Cliente (pipeline) — MODIFY: bloco "Resumo da última ligação".
- Painel Inteligente — MODIFY: seção "Última ligação".

## Tasks (backend)
1. **Schema** — Call.transcript/insight/insightState + migração offline. (controller faz.)
2. **transcribeBuffer** — refatora TranscriptionService (extrai buffer→Whisper), `transcribe()` reusa. Testes existentes verdes + teste do buffer.
3. **RecordingDownloader** — `download(url): {buffer, mime}`; lança se vazio/HTML/não-áudio (pra retry). Teste com fetch mock (vazio→throw, ok→retorna).
4. **CallInsightService.summarize** — LLM chat-completions, prompt de ligação, parse JSON {summary,nextSteps,sentiment}, fallback. Teste com fetch/axios mock.
5. **CallInsightProcessor** — orquestra: load Call → download → transcribeBuffer → summarize → grava READY + emite; SKIPPED se sem gravação; throw pra retry se download falha. Teste com deps mockadas.
6. **Webhook enfileira** — SonaxWebhookService injeta a fila e faz `queue.add('insight',{callId},{attempts,backoff})` quando terminal+answered+recordingUrl. Teste: enfileira sim/não.
7. **Endpoints + service** — latest-insight + transcript (escopo org). Teste do service.
8. **Module wiring** — registerQueue, providers, imports. tsc + jest verde.

## Tasks (frontend)
9. call-card expande resumo + estado processando.
10. calls.service getLatestInsight/getTranscript.
11. Card do Cliente: bloco Resumo da última ligação.
12. Painel Inteligente: seção Última ligação.

## Notas
- Migração offline (sem DB local): `cp schema baseline` → editar → `prisma migrate diff --from-schema-datamodel baseline --to-schema-datamodel schema --script > migration.sql` → `prisma generate`.
- TranscriptionService paths: PrismaService=`../../database/prisma.service`. Crypto/Realtime como no calls.
- BullMQ: `BullModule.registerQueue({name})`, `@Processor(QUEUE)` extends WorkerHost, `@InjectQueue(QUEUE)`.
- Deploy: cache BuildKit teimoso → `docker compose build --no-cache api web` se cache-hit.
