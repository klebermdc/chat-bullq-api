# Voz da Aline — SPEC

> Status (13/11/2026): **F1 e F2 concluídas; caminho validado pelo Kleber** ("ficou muito bom"). Próximo: aperfeiçoar e seguir para F3 → F6 → F4 (ordem nova, ver abaixo).
> Valores que o Kleber precisa fornecer aparecem como **[PENDENTE]**; decisões a confirmar, como **[Aprovar]**.

## Estado em 13/11/2026 — o que foi validado

### Função da Aline na voz (decisão do Kleber)

**Ligação de retorno de cotação.** A Aline liga para quem recebeu uma cotação e:
1. confirma se o cliente recebeu e viu a cotação;
2. pergunta se ficou dúvida (só para entender — não fala de valores);
3. oferece marcar uma conversa com o **vendedor que atende o cliente**, combina dia e horário e repete para confirmar;
4. encerra dizendo que o vendedor vai entrar em contato no horário combinado.

Casos de borda já no prompt: não recebeu (vendedor reenvia pelo WhatsApp), sem interesse / "não me ligue" (encerra sem insistir), atendeu outra pessoa (pergunta melhor horário). Preço, desconto e parcelamento: sempre com o vendedor. Ela se apresenta como **"Aline, da OFP"**.

Implementação: "missão" passada no metadata do job do LiveKit — `{"missao":"retorno_cotacao","cliente":"…","vendedor":"…"}` (`voice/agent/src/missions.ts`; nomes higienizados contra injeção de instruções). Sem missão, cai no atendimento padrão (qualificação SDR).

### Pilha que funcionou (medida com robô de 3 perguntas e com o Kleber na sala)

| Peça | Escolha | Onde roda | Medida |
|---|---|---|---|
| Mídia / SIP | LiveKit v1.13.11 + livekit/sip v1.24 (TLS 5061, SRTP SDES, **OPUS ligado no `sip.yaml`**) | VPS, `/opt/voz` | OPUS + SRTP conferidos com ligação SIP real |
| VAD | Silero (400 ms de silêncio) | agente | — |
| Transcrição | **Whisper large-v3-turbo** (mlx-audio) | **Mac mini M4** do Kleber, via túnel SSH | 0,9 s no Mac; ~1,9 s pelo túnel |
| LLM | **Claude Haiku 5.5**, `effort: low` (provedor `anthropic`) | API da Anthropic | 1ª palavra 0,6–0,9 s, estável |
| Voz | **Qwen3-TTS 0.6B Base** com **voz clonada da Renata** (referência de 24,7 s, sem dado de cliente), streaming, temperatura 0,3 | Mac mini, via túnel | 1º áudio 0,4–0,6 s |
| Resultado | | | **~3,5 s por turno** (era 6–10 s na CPU da VPS) |

Tentativas descartadas, com motivo: Speaches/Kokoro e Piper na CPU da VPS (lento; sotaque "gringo" ou voz masculina); Qwen3 com vozes prontas, instrução de sotaque e VoiceDesign (sotaque de Portugal); MiniMax-M2.5-highspeed na voz (instável 0,4–4,5 s, solta inglês e cola palavras — segue no WhatsApp). RunPod configurado mas não usado (o Mac resolveu de graça).

Peças do agente que nasceram na F2: TTS próprio que toca enquanto recebe (`streaming-tts.ts` — o plugin oficial esperava a frase inteira), fila de uma frase por vez no TTS (`serial-fetch.ts`), campos extras por configuração no pedido de voz e de LLM (`TTS_EXTRA_BODY`, `LLM_EXTRA_BODY`), filtro de fala, medidor de latência, robô de teste (`robo-teste.ts`). 27 testes.

### Consequência para as fases: a ordem muda

A função escolhida é **ligação de saída**. Pela Meta, ligação de saída só com **permissão de chamada** do cliente. Nova ordem:

1. **F3 — Ferramentas** focadas na missão (abaixo).
2. **F6 — Ligações de saída** (permissão + disparo). Vira o coração do produto.
3. **F5 — Pós-ligação** junto com a F6 (resultado da ligação no card).
4. **F4 — Ligação de entrada** fica para depois (continua no plano, sem pressa).

**Permissão de chamada (decidido em 13/11):** o Sendtur pede a permissão **automaticamente logo depois do envio da cotação** (mensagem interativa de permissão de chamada), para que a Aline possa ligar depois. Conferir na doc da Meta os limites de pedidos e a cobrança da ligação de saída no Brasil antes de codar.

**Quando a Aline liga (decidido pelo Kleber em 13/11):** **24 h depois do envio da cotação, se o cliente não respondeu**, só no horário de atendimento da agência (`Organization.aiBusinessHours`) e só se o cliente deu permissão de chamada. Prazo configurável por agência (padrão 24 h). A cotação por link já registra envio; se registrar visualização, usar também.

**"Agendar conversa com o vendedor" (decidido em 13/11):** vai para uma **agenda própria do Sendtur** (sem Google Agenda) — ver "Agenda do vendedor no Sendtur" na F3. Grava no card, avisa o vendedor por push. Nada de agendamento sem confirmação do cliente na ligação.

### Aperfeiçoamentos já mapeados

1. **Primeira resposta lenta (~10 s):** o servidor do Mac atende um pedido por vez e a saudação compete com a 1ª transcrição. Guardar a saudação já gerada (cache por cliente+vendedor) e liberar a fila.
2. **Mac como servidor:** hoje servidor e túnel rodam "na mão". Para uso real: iniciar sozinhos (launchd), impedir o Mac de dormir e cair para o Speaches da VPS se o Mac sumir.
3. **Geografia:** o áudio vai Brasil → Boston → Brasil (Mac) → Boston. Rodar o agente no próprio Mac (STT/TTS locais) ou mover a voz para São Paulo deve tirar ~1 s.
4. **Consentimento da voz:** registrar por escrito a autorização da Renata para uso da voz clonada.
5. **Higiene de segredos:** trocar a chave da RunPod e a da Anthropic (foram coladas no chat).
6. **Segurança (fora da voz):** os áudios em `/api/v1/uploads/audio/...` do Sendtur abrem sem login; corrigir na API.

## Objetivo

Dar voz à Aline: atender ligações que o cliente faz pelo WhatsApp e ligar para clientes que deram permissão, usando a **WhatsApp Cloud API Calling em modo SIP** (sinalização TLS, mídia SRTP com chave SDES, codec OPUS).

Fora do escopo agora: Sonax e telefone comum. A arquitetura deixa um ponto de encaixe para um tronco SIP extra depois (ver "Tronco SIP extra" no fim).

---

## Fase 0 — Diagnóstico do repositório (feito em 12/11/2026)

Base analisada: `chat-bullq-api`, branch de produção `feat/conversation-tabs` (commit `1b998ac`), mais a VPS de produção.

### 0.1 Correção de premissa: o Sendtur não usa Supabase

O pedido fala em "Supabase do Sendtur" e "Realtime". O sistema real é outro:

| Pedido | O que existe de verdade |
|---|---|
| Supabase (banco + RPC) | **NestJS 11 + Prisma 6 + Postgres 16** no container `chat-ofp-postgres-1` |
| Supabase Realtime | **socket.io** (`src/modules/realtime/realtime.gateway.ts`), salas `org:`, `channel:`, `conv:` |
| Edge functions / RLS | Módulos NestJS; o isolamento por empresa é feito no código (`organizationId` em toda consulta), não por RLS |

Consequência: as ferramentas do agente de voz **chamam a API do Sendtur por HTTP** (endpoints novos num módulo `voice`), e a UI recebe eventos pelo socket.io que já existe. Não entra Supabase em nenhuma fase.

### 0.2 Integração com a Cloud API (WhatsApp oficial)

| Item | Onde está | Observação |
|---|---|---|
| Envio | `channel-hub/adapters/whatsapp-official/whatsapp-official.http-client.ts` → `POST /{phoneNumberId}/messages` | axios, `baseURL https://graph.facebook.com/{apiVersion}` |
| Token e phone_number_id | `channels.config` (JSON): `accessToken`, `phoneNumberId`, `businessAccountId`, `apiVersion` | Token **em texto puro no JSON** do canal; a API mascara na resposta (`channel-masking.ts`). Não é cifrado como o da Sonax (`token_enc`). |
| Versão da Graph | default `v21.0` no http-client | v21 é removida em 21/01/2027. Calling precisa de versão nova: as chamadas de calling usam **v23.0 ou mais nova** sem mexer no envio de mensagens. |
| Webhooks | `channel-hub/webhook-gateway.controller.ts` (`POST /webhooks/:channelType`), assinatura em `meta-shared/meta-signature.util.ts`, fila `webhook-events.service.ts` | O inbound adapter trata `messages`, templates, `history`, `smb_*`, `account_update`. O campo `calls` cai em `unhandledFields` — e com SIP ligado a Meta nem manda esse webhook. |
| Templates | `channel-hub/message-templates/` | Útil na F6 (pedido de permissão de ligação é mensagem interativa) |
| Onboarding | `docs/whatsapp-official-onboarding.md`, `docs/whatsapp-embedded-signup-runbook.md` | Embedded Signup já funciona |

Números: o canal principal de vendas é o 5198-4190 (phoneNumberId `343333345533421`, TIER_10K, qualidade GREEN em 12/11). Há 4 canais oficiais ativos.

### 0.3 Schema que interessa

- `Organization` — já tem `aiTimezone`, `aiBusinessHours`, `aiOffHoursMode`, `aiBusinessNotes`, `aiSecurityRules`, `settings` (JSON). **Horário de atendimento por agência já existe.**
- `Channel` — por org; `config` com credenciais; `aiEnabled` por canal.
- `Contact` — `organizationId + phone` (índice), sem unicidade; a busca flexível por telefone já existe (busca sem acento/telefone flexível, PR #271).
- `Conversation`, `Message`, `ConversationParticipant` — conversa por contato + canal.
- `Pipeline` / `PipelineStage` / `Card` — o "funil"; `Card` liga em `Contact`.
- `AiAgent` — `systemPrompt`, `operationalContext`, `modelId`, `voiceProfile` (hoje é **estilo de texto**, "consultive"/"warm", não voz falada), ligação a canais por `AiAgentChannel`.
- `AiProviderKey` — chave de IA por org e capacidade (`AGENT_LLM`, `TRANSCRIPTION`, `EMBEDDINGS`); provedores `GROQ | OPENAI | SAKANA`, com `baseUrl`/`model` livres (é assim que o MiniMax entra).
- **`Call` já existe** (ligações Sonax): `conversationId` obrigatório, `ramal` e `numero` obrigatórios, `agentId` = usuário humano, `recordingUrl`, `transcript`, `insight` (`{summary, nextSteps, sentiment}`), `insightState`. Índices por org/data e por conversa.
- `ScheduledMessage` — mensagens agendadas (não é agenda de compromisso).

### 0.4 Agente de IA atual (texto)

- `ai-agents/runner/agent-runner.service.ts` + `prompt-builder.service.ts` — monta prompt com horário, plantão, regras comerciais.
- `ai-agents/llm/llm.service.ts` — cliente OpenAI-compatível apontado para o provedor da org (hoje MiniMax). **O MiniMax solta `<think>` no texto** (incidente de 09/11); tudo que vai ao cliente passa por `stripThinkBlocks` (`text-guards.ts`).
- `ai-agents/tools/` — interface `AiTool { name, description, parameters, execute(input, ctx) }` com `ToolContext { organizationId, conversationId, contactId, channelId, agentId, runId }`. Ferramentas prontas que importam: `transfer-to-human`, `reply-to-conversation`, `leave-note-for-seller`, `set-lead-temperature`, `tag-conversation`, `agendar-reuniao` (Google Calendar), `send-emergency-contact`, `open-support-ticket`.
- Regras de negócio da Aline que valem também na voz: só SDR (não negocia preço/desconto/parcela), regra do plantão, visto EUA, travas de saída comercial (`outbound-guards/`).

### 0.5 Autenticação multi-tenant

- Usuários: JWT (`auth/jwt.strategy.ts`), papel por org em `UserOrganization` (`OrgRole`), acesso por canal em `iam/channel-access`.
- Integrações: chave `pk_…` (`auth/api-key.strategy.ts`) amarrada a um usuário + org; usada pela API pública (`public-api/`) e pelo MCP.
- Para o serviço de voz: **não usar `pk_` de usuário**. Criar credencial de serviço própria (segredo compartilhado + assinatura por requisição) e o `organizationId` vem do número chamado, resolvido pela própria API — o agente nunca escolhe a org.

### 0.6 Pós-ligação já pronto (Sonax)

`calls/call-insight.processor.ts` (fila BullMQ): baixa a gravação → transcreve (Whisper via chave `TRANSCRIPTION`) → resume com o LLM da org → grava em `Call` → emite `call:insight` na conversa. O web já mostra o card de ligação com resumo na timeline. **Reaproveitável quase inteiro na F5.**

### 0.7 Deploy hoje

- VPS Hostinger (187.77.213.165): **2 vCPU, 7,8 GB RAM (≈4 GB livres), 40 GB de disco livre**. Divide máquina com os containers `bralimpia-*`.
- `/opt/chat-ofp`: `docker-compose.yml` + `override` com `api, web, mcp, caddy, postgres, redis, minio`. Caddy faz TLS em 80/443 (`{$API_DOMAIN}`, `{$WEB_DOMAIN}`, `sendtur.com.br`).
- Firewall (ufw): só 22, 80 e 443 abertos.
- Deploy: `deploy-safe.sh` com `BRANCH=feat/conversation-tabs`, migração Prisma roda no boot da API. Quem mescla e faz deploy é o Kleber.

### 0.8 O que reaproveitar

1. Busca de contato por telefone e criação de contato/conversa do fluxo de entrada.
2. Interface `AiTool` e as ferramentas `transfer-to-human`, `leave-note-for-seller`, `set-lead-temperature`, `tag-conversation`, `agendar-reuniao` — expostas ao agente de voz por endpoints, sem reescrever a regra.
3. `Organization.aiBusinessHours/aiTimezone/aiOffHoursMode` como horário da voz.
4. `AiAgent.systemPrompt/operationalContext` como base do prompt de voz (com um bloco de voz por cima).
5. `AiProviderKey` para a chave do LLM (MiniMax) e da transcrição.
6. Tabela `calls` + `call-insight.processor` + card de ligação no web.
7. `RealtimeGateway.emitToConversation` para a UI.
8. MinIO para gravações; `WhatsAppOfficialHttpClient` como base para as chamadas de `settings` e `call_permissions`.
9. `text-guards.ts` (`stripThinkBlocks`) antes de qualquer texto virar fala.

### 0.9 Riscos

| # | Risco | Peso | Mitigação |
|---|---|---|---|
| R1 | **OPUS no livekit/sip**: a Meta exige OPUS no SIP; o livekit/sip nasceu com G.711/G.722. | Resolvido (13/11) | Teste real em 13/11: baresip → sip.sendtur.com.br negociou TLS + `opus/48000/2` + `SRTP_AES128_CM_HMAC_SHA1_80` (SDES) e entrou na sala. Exige `codecs: opus: true` no sip.yaml (vem desligado). Antes: o código do livekit/sip v1.24 (media-sdk de 10/11/2026) registra `opus/48000/2` como codec SIP e faz SRTP com SDES (`a=crypto`, `RTP/SAVP`, AES_CM_128_HMAC_SHA1_80). Falta confirmar com ligação real. Primeiro teste da F1: confirmar na versão escolhida que o SDP oferece/aceita `opus/48000/2` com SRTP SDES. Se não, avaliar trocar o componente SIP antes de seguir. |
| R2 | **Voz na mesma VPS da produção** (decisão do Kleber em 13/11: upgrade para KVM 4 — 4 vCPU, 16 GB, 193 GB — em Boston). LiveKit precisa de UDP; VAD e mídia comem CPU. | Médio | Projeto compose separado (`/opt/voz`), limites de CPU/RAM nos containers de voz, faixas UDP estreitas, nada de porta nova para Postgres/Redis/MinIO, alerta de carga. Se a voz pesar na inbox, mover para VPS própria (a arquitetura não muda). |
| R3 | **Latência do MiniMax**: modelo que "pensa" atrasa a resposta e pode falar o `<think>`. | Alto | Na F2 medir; usar modelo sem raciocínio para voz se preciso; `stripThinkBlocks` obrigatório antes do TTS. |
| R4 | **Ativar calling no número de vendas** mostra o botão de ligar para todos os clientes. | Alto | Testar em número separado [PENDENTE]; no número de produção só com horário e transbordo prontos. |
| R5 | `calls` foi desenhada para Sonax (`ramal`, `numero`, `conversationId` obrigatórios, `agentId` = humano). | Médio | Migração aditiva na F5 (colunas novas, `ramal` opcional); nada muda para a Sonax. |
| R6 | Token da Meta em texto puro em `channels.config`. | Médio | O serviço de voz **nunca** recebe o token; só a API fala com a Graph. Cifrar o token fica como item separado. |
| R7 | Graph v21 removida em 21/01/2027; calling exige versão nova. | Médio | Cliente de calling com versão própria (`v23.0`+). |
| R8 | Política da Meta contra assistente de IA de uso geral. | Médio | Prompt restrito ao negócio da agência; recusa educada fora do tema; teste de aceite específico. |
| R9 | LGPD: gravação de voz. | Médio | Aviso de gravação no início da ligação; retenção configurável por agência. |
| R10 | Detalhes da Meta que mudam (limites de pedidos de permissão, cobrança por minuto na ligação de saída, país). | Médio | Conferir a doc oficial no início da F4 e da F6 e anotar aqui. |
| R11 | Repositório no iCloud trava `tsc/git`. | Baixo | Trabalhar em `~/dev`. |

---

## Arquitetura

```
 Cliente (app WhatsApp)
        │ VoIP
        ▼
 Meta (wa.meta.vc) ──SIP/TLS 5061 + SRTP(SDES)/OPUS──►  VPS de voz
                                                       ┌──────────────────────────────┐
                                                       │ livekit/sip  ─┐               │
                                                       │ livekit-server├─ Redis        │
                                                       │ livekit/egress┘ (gravação)    │
                                                       │ agente "aline-voz" (agents-js)│
                                                       │  VAD Silero → STT → LLM → TTS │
                                                       └──────┬───────────────┬───────┘
                                         ferramentas (HTTPS,  │               │ webhooks LiveKit
                                         assinatura de serviço)│               │ + relatório de fim
                                                              ▼               ▼
                                                 API Sendtur (VPS atual) — módulo `voice`
                                                 Postgres · BullMQ · socket.io → web
```

Decisões:

- **Serviço de voz na pasta `voice/` deste repositório** (decisão 13/11), rodando em containers próprios em `/opt/voz` — deploy da API não derruba ligação. A API ganha o módulo `voice` (endpoints + migração).
- **Só a API fala com a Graph** (settings, permissões, mensagens). O agente pede à API.
- **Org vem do número chamado**: tronco/regra de despacho por número → a API resolve `phoneNumberId → channel → organization`.
- **STT e TTS self-hosted (decisão do Kleber, 13/11):** Speaches (`ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu`) na rede `voz_ia`, sem porta publicada. STT faster-whisper small int8 (pt), TTS Kokoro 82M ONNX (pf_dora, pm_alex, pm_santa). O agente usa os plugins OpenAI do LiveKit com `STT_BASE_URL/STT_MODEL` e `TTS_BASE_URL/TTS_MODEL/TTS_VOICE` — trocar por Qwen3-TTS em GPU ou outro provedor = mudar URL e modelo. Medição isolada 13/11 (2 CPUs): TTS frase curta 1,6 s; STT de 2 s de áudio 3,2 s (custo fixo alto, investigar na F2).
- **Provedores atrás de interface** no serviço de voz: `SttProvider`, `LlmProvider`, `TtsProvider`, escolhidos pela configuração da agência. Padrões iniciais sugeridos: STT Deepgram (pt-BR streaming), LLM o da org (MiniMax, compatível com OpenAI), TTS com voz pt-BR natural (ElevenLabs ou Cartesia) [PENDENTE escolha].
- **Eventos para o CRM saem do LiveKit** (webhooks do servidor + relatório que o agente manda ao fim), porque com SIP a Meta não manda webhook de chamada.

### Configuração por agência (multi-tenant)

Tabela nova `voice_agent_settings` (uma por org, opcionalmente por canal):

| Campo | Uso |
|---|---|
| `organization_id`, `channel_id?` | escopo |
| `enabled` | liga/desliga a voz |
| `ai_agent_id` | qual `AiAgent` dá o prompt base |
| `voice_prompt_extra` | regras só de voz (frases curtas, sem listas, números por extenso) |
| `greeting` | primeira fala, inclui aviso de gravação |
| `stt_provider/model`, `tts_provider/voice_id`, `llm_model?` | provedores |
| `tools_enabled` (lista) | quais ferramentas a voz pode usar |
| `hours_mode` | usa `Organization.aiBusinessHours`; fora do horário: atender e anotar / recusar com mensagem |
| `record_calls`, `retention_days` | gravação |
| `transfer_target` | para onde vai o transbordo (vendedor dono, fila, número) |

Chaves de provedores de voz seguem o padrão `AiProviderKey` (nova capacidade `VOICE_STT`/`VOICE_TTS`) ou `.env` do serviço de voz na primeira versão [Aprovar].

---

## F1 — Infra (LiveKit + SIP + Redis, TLS, portas, DNS)

**Entregáveis**
- Pasta `voice/` do chat-bullq-api com `docker-compose.yml` próprio, instalado em `/opt/voz` na **mesma VPS** (187.77.213.165, KVM 4): `livekit-server`, `livekit-sip`, `redis` **próprio** (não usar o `chat-ofp-redis-1`), `egress` (desligado até a F5). O TLS de `livekit.sendtur.com.br` entra como um bloco novo no Caddy existente (com backup do Caddyfile antes).
- Limites nos containers de voz (sugestão inicial: 2 CPUs e 4 GB no total), para a produção ter sempre pelo menos 2 núcleos livres.
- `livekit.yaml`, `sip.yaml` com TLS (porta 5061, certificado de `sip.<domínio>`), faixa RTP limitada, `media_encryption` exigida.
- `.env.example` com todas as variáveis; `.env` só na VPS.
- DNS: `livekit.<domínio>` e `sip.<domínio>` → IP da VPS de voz [PENDENTE].
- Firewall (ufw da VPS de produção — mudança feita com o Kleber): abrir só 5061/tcp (SIP TLS), 7881/tcp, faixa UDP do WebRTC (ex. 50000–50200) e faixa RTP do SIP (ex. 10000–10200). Nenhuma outra porta muda.
- Certificado público válido para `sip.<domínio>` renovando sozinho (a Meta recusa certificado inválido).
- `docs/voz-ia/RUNBOOK-infra.md`: subir, parar, ver logs, renovar certificado.

**Critérios de aceite**
1. `docker compose up -d` sobe tudo; `livekit-cli` lista salas com a API key do `.env`.
2. `openssl s_client -connect sip.<domínio>:5061` mostra certificado válido.
3. Uma chamada SIP de teste (ex. softphone com TLS+SRTP, ou `sipp`) chega ao livekit/sip e cria sala.
4. **R1 resolvido**: o SDP negociado mostra OPUS e SRTP (SDES). Se falhar, a F1 para aqui e volta para decisão.
5. Produção (`/opt/chat-ofp`) intocada, fora o bloco novo no Caddy: inbox e API respondendo igual durante e depois da subida; com uma ligação de teste ativa, a CPU da máquina fica abaixo de 60%.

**[PENDENTE]** domínio (`sendtur.com.br`?) e quem cria o DNS (`livekit.` e `sip.` → 187.77.213.165).

## F2 — Agente básico numa sala de teste pelo navegador

**Entregáveis**
- Worker `aline-voz` em agents-js (TypeScript): `AgentSession` com VAD Silero, STT, LLM, TTS em pt-BR, interrupção ligada.
- Camada de provedores (`providers/stt|llm|tts`) escolhida por config; troca de provedor sem mexer no agente.
- Filtro de texto antes do TTS: remove `<think>`, markdown, emoji, URL.
- Página de teste (LiveKit Meet ou página mínima) que entra numa sala e fala com a Aline.
- Prompt fixo de teste (ainda sem buscar config na API), com as regras: atendente da agência, só SDR, sem preço/desconto/parcela, recusa assunto fora do negócio.
- Métricas por turno no log: tempo fim-da-fala → primeiro áudio.

**Critérios de aceite**
1. Conversa de 3 minutos em português sem queda.
2. Interrupção: falar por cima da Aline faz ela parar em menos de ~300 ms.
3. Latência fim-da-fala → início da resposta: mediana ≤ 1,5 s, p90 ≤ 2,5 s (medida em 20 turnos).
4. Nenhum `<think>` ou markdown falado (teste com prompt que provoca raciocínio).
5. Pergunta fora do negócio ("me ajuda com dever de casa") é recusada e volta para viagem.
6. Trocar o TTS por variável de ambiente funciona sem mudar código do agente.

**[PENDENTE]** chaves de STT/TTS; voz escolhida (ouvir 2–3 opções).

## F3 — Ferramentas do Sendtur

**Prioridade (13/11): as ferramentas da missão "retorno de cotação" vêm primeiro.**

| Ferramenta | O que faz | Reaproveita |
|---|---|---|
| `dados_da_ligacao` (pela API, antes de ligar) | cliente, vendedor dono, cotação enviada (data, link, status de visualização) → vira o metadata da missão | conversa, card, cotação por link |
| `registrar_resultado` | grava no card o desfecho: viu / não recebeu / tem dúvida (texto) / sem interesse / não era o cliente | `leave-note-for-seller`, card |
| `horarios_livres_vendedor` | devolve 3–4 horários livres do vendedor nos próximos dias, para a Aline oferecer horários reais | agenda nova (abaixo) + horário de trabalho do vendedor |
| `agendar_conversa_vendedor` | cria o compromisso na **agenda do Sendtur**, mostra no card/conversa e avisa o vendedor (push) | agenda nova (abaixo), push do vendedor |
| `pedir_reenvio_cotacao` | avisa o vendedor para reenviar a cotação pelo WhatsApp (e confere o número) | push do vendedor |
| `nao_ligar_mais` | marca o contato para não receber ligação da Aline (opt-out) | `Contact.metadata` |

Depois delas, as genéricas abaixo (atendimento de entrada).

### Agenda do vendedor no Sendtur (decidido em 13/11: sem Google Agenda)

O calendário de contratos que existe (`contracts/calendar`) só monta eventos a partir dos contratos para o Google; não guarda compromissos. A agenda é um **módulo novo** (`agenda`), útil além da voz (o vendedor também marca retornos à mão).

**Dados — tabela `appointments`:** `organization_id`, `owner_user_id` (vendedor), `contact_id`, `conversation_id?`, `card_id?`, `starts_at` (timestamptz), `duration_min` (padrão 15), `kind` (`RETORNO_LIGACAO` | `REUNIAO`), `status` (`MARCADO` | `FEITO` | `CANCELADO` | `NAO_ATENDEU`), `source` (`ALINE_VOZ` | `MANUAL` | `ALINE_CHAT`), `notes`, `call_id?`, `created_by_user_id?`, datas de criação/alteração. Índice `(organization_id, owner_user_id, starts_at)`.

**Regras:**
- Só no horário de trabalho do vendedor e sem conflito com outro compromisso dele (a API recusa; a Aline oferece os horários de `horarios_livres_vendedor`).
- Vendedor vê e mexe só na própria agenda; ADMIN/OWNER veem a de todos.
- Lembrete por push ao vendedor **10 min antes** e na hora ("ligar para Kleber agora"), por fila BullMQ com atraso; cancelar/remarcar refaz os lembretes.
- Compromisso marcado pela Aline aparece na conversa (mensagem de sistema) e como etiqueta no card do funil ("Retorno amanhã 15h").
- Confirmação ao cliente por WhatsApp depois da ligação **[Aprovar]** (texto curto com dia/hora e o nome do vendedor).

**Telas (web):** página **Agenda** (dia e semana, filtro por vendedor para gestão), atalho "Marcar retorno" na conversa, e o bloco do compromisso no card.

**Critérios de aceite:**
1. Na ligação de teste, ao topar, a Aline oferece horários livres reais do vendedor e o compromisso aparece na Agenda, na conversa e no card sem recarregar a página.
2. Horário fora do expediente ou em conflito é recusado e a Aline oferece outro.
3. O vendedor recebe o push 10 min antes; remarcar muda o lembrete.
4. Vendedor A não vê a agenda do vendedor B.
5. Testes do módulo com cobertura ≥ 80%.

**Entregáveis (API, módulo `voice`)**
- Credencial de serviço: segredo compartilhado + assinatura HMAC por requisição (corpo + timestamp), anti-replay; sem `pk_` de usuário.
- `GET /voice/session-config?calledNumber=&callerNumber=` → org, canal, prompt montado, voz, horário, ferramentas liberadas, contato/conversa achados ou criados.
- Endpoints de ferramenta (todos recebem `callId`, a org vem da sessão, nunca do agente):
  - `buscar_lead` — contato por telefone (busca flexível existente), card aberto, vendedor dono, últimas mensagens.
  - `criar_ou_atualizar_card` — cria card no funil da agência ou move/anota o existente.
  - `agendar` — [PENDENTE: o que é "agendar" para a agência — retorno do vendedor, reunião no Google Agenda (`agendar-reuniao`) ou lembrete]
  - `enviar_whatsapp` — manda texto/link na conversa durante a ligação, respeitando janela de 24h/7 dias e as travas de saída.
  - `transferir_para_humano` — reaproveita `transfer-to-human` (dono/fila, plantão, aviso) e devolve para o agente se a transferência na ligação é possível ou se fica "vendedor liga de volta".
- No serviço de voz: cliente HTTP dessas ferramentas registrado como function calling no `AgentSession`, com tempo limite e fala de espera ("só um instante").
- Testes unitários dos endpoints (isolamento por org, assinatura inválida, telefone sem contato).

**Critérios de aceite**
1. Na sala de teste, "sou o fulano, meu número é X" → Aline acha o lead certo da org certa.
2. Pedido de orçamento cria/atualiza card e aparece no funil do web em tempo real.
3. "Me manda por WhatsApp" chega na conversa do cliente com a assinatura certa.
4. Pedir para falar com alguém aciona o transbordo com a mesma regra do texto (plantão da Aline incluso).
5. Requisição com assinatura errada ou de outra org → 401/404, sem vazar dado.
6. Cobertura de testes do módulo `voice` ≥ 80%.

**Transferência ao vivo** (passar a ligação para o celular do vendedor) fica para depois: na F3 o transbordo é "vendedor assume a conversa e liga de volta". [Aprovar]

## F4 — Ativar calling + SIP no número e receber a 1ª ligação

**Entregáveis**
- Na API: serviço `WhatsAppCallingSettings` (Graph v23+) com:
  - `POST /{PHONE_NUMBER_ID}/settings` → `calling.status=ENABLED`, `call_icon_visibility`, `callback_permission_status=ENABLED`, `calling.sip.status=ENABLED`, `sip.servers=[{hostname: sip.<domínio>, port: 5061, …}]`, protocolo de chave SRTP = SDES.
  - `GET /{PHONE_NUMBER_ID}/settings` (com credenciais SIP) para obter a senha SIP que a Meta gera.
  - Endpoint admin no web/API para ligar/desligar por canal (só OWNER/ADMIN), com o horário da agência refletido no ícone de ligação quando a Meta permitir.
- No LiveKit: tronco de entrada com o número, autenticação com a senha da Meta, mídia criptografada exigida; regra de despacho → sala individual `wa-<callId>` com o agente `aline-voz` despachado.
- Webhooks do LiveKit → `POST /voice/webhooks/livekit` (assinatura do LiveKit) criando o registro da chamada.
- Runbook `docs/voz-ia/RUNBOOK-ativacao.md` (ligar, desligar, voltar atrás).

**Critérios de aceite**
1. Ligação do WhatsApp de um celular de teste para o número de teste é atendida pela Aline em até 3 toques.
2. Áudio nos dois sentidos, sem eco, 5 minutos sem queda.
3. Org, contato e conversa certos no log da sessão.
4. Fora do horário, comportamento segue `hours_mode`.
5. Desligar pelo endpoint admin faz o número voltar a não aceitar ligação.
6. Antes de ativar no número de produção: F3 e F5 prontas e aprovação explícita do Kleber.

Número: **5198-4190 de vendas** (decisão do Kleber, 13/11 — ativar só com horário, transbordo e F5 prontos); confirmar elegibilidade do número na Meta (calling disponível no Brasil para a WABA).

## F5 — Pós-ligação, tabela `calls` e UI

**Entregáveis**
- Migração aditiva em `calls`: `provider` (`SONAX` | `WHATSAPP_VOICE`), `direction` (`INBOUND` | `OUTBOUND`), `ai_agent_id`, `livekit_room`, `sip_call_id`, `end_reason`, `transcript_segments` (JSON com falante e tempo), `ramal` passa a opcional. Sonax continua igual.
- Gravação: egress só de áudio → MinIO (bucket próprio, caminho por org), `recordingUrl` assinado.
- Transcrição: a do STT ao vivo vai para `transcript`/`transcript_segments` (sem pagar Whisper de novo); o resumo usa o `call-insight` existente (`summary`, `nextSteps`, `sentiment`).
- Mensagem de sistema na conversa ("Ligação com a Aline · 4 min") e card de ligação reaproveitado no web, com player, transcrição e resumo; eventos `message:new`, `message:update`, `call:insight` pelo socket.io.
- Retenção: apagar gravação após `retention_days`.

**Critérios de aceite**
1. Ao desligar, em até 60 s o card mostra duração, gravação, transcrição e resumo, sem recarregar a página.
2. Ligação Sonax continua funcionando igual (teste de regressão do `call-insight`).
3. Ligação de cliente sem conversa cria a conversa no canal certo.
4. Gravação só acessível por usuário da mesma org.
5. Ligação caída no meio ainda gera registro com `end_reason`.

## F6 — Ligações de saída (permissão + API para disparar)

**Entregáveis**
- Na API:
  - Consulta de permissão `GET /{PHONE_NUMBER_ID}/call_permissions?user_wa_id=` antes de **toda** discagem.
  - Envio do pedido de permissão (mensagem interativa `call_permission_request`) com controle de limite por cliente.
  - `POST /voice/calls/outbound { conversationId, motivo }` — checa permissão, horário, se a voz está ligada para a org; dispara no LiveKit a criação do participante SIP no tronco de saída para a Meta; registra a `Call` com `direction=OUTBOUND`.
  - Botão "Aline liga" no web (só aparece com permissão válida) [Aprovar o lugar do botão].
- No LiveKit: tronco de saída para a Meta (TLS, SRTP, credenciais SIP do número).
- Prompt de abertura de saída (quem é, de qual agência, motivo da ligação).

**Critérios de aceite**
1. Cliente sem permissão: a API recusa e oferece mandar o pedido de permissão; nenhuma discagem.
2. Cliente com permissão: o WhatsApp dele toca, Aline se apresenta e o pós-ligação da F5 funciona igual.
3. Permissão revogada/expirada é respeitada (consulta na hora, não em cache).
4. Limites da Meta conferidos na doc e aplicados no código (anotar aqui ao começar a F6).
5. Fora do horário da agência a discagem é recusada.

---

## Tronco SIP extra (preparado, não implementado)

- Tronco = configuração no LiveKit (entrada e saída), não código no agente.
- `voice_agent_settings` aceita um `trunk_kind` (`WHATSAPP` | `SIP_EXTERNO`) e o `session-config` resolve a org pelo número chamado em qualquer tronco.
- A tabela `calls` já ganha `provider`; um tronco comum entraria como novo valor.

## Regras que valem em todas as fases

- A Aline é atendente da agência (viagens, pacotes, agendamento), não assistente de uso geral.
- Mesmas regras do texto: só SDR, sem negociação de preço, plantão, visto EUA, travas de saída.
- Ligação de saída só com permissão confirmada na hora.
- Nenhum segredo no código: `.env` + `.env.example` nos dois repositórios.
- Aviso de gravação no começo de toda ligação gravada.
- Nada vai para produção sem o Kleber mesclar e fazer o deploy.

---

## Checklist para o Kleber

Antes da F1, responder os **[PENDENTE]**: VPS de voz, domínio/DNS, número de teste, provedores de STT/TTS e chaves, o que é "agendar", e aprovar as decisões marcadas [Aprovar].

Cada prompt abaixo é para colar numa sessão nova, na ordem.

**F1 — Infra**
> Leia `docs/voz-ia/SPEC.md` (repo chat-bullq-api, branch docs/voz-ia-spec). Execute a F1: use a pasta `voice/` do chat-bullq-api, com docker-compose próprio (livekit-server, livekit-sip, redis próprio, egress desligado) para `/opt/voz` na VPS 187.77.213.165, com limites de CPU/RAM, TLS na 5061, SRTP exigido, `.env.example` e o RUNBOOK-infra. Domínios: livekit.sendtur.com.br e sip.sendtur.com.br (DNS feito 13/11). Comece pelo critério 4 (OPUS + SRTP SDES no livekit/sip) e pare para me avisar se falhar. Antes de mexer no Caddy ou no ufw da produção, me mostre a mudança e espere meu OK.

**F2 — Agente na sala de teste**
> Leia `docs/voz-ia/SPEC.md`. Execute a F2 na pasta `voice/`: worker `aline-voz` em agents-js com VAD Silero, STT [provedor], LLM da org (MiniMax, compatível com OpenAI), TTS [provedor/voz], interrupção ligada, camada de provedores trocável, filtro de `<think>`/markdown antes do TTS e métrica de latência por turno. Me entregue o link da sala de teste e a tabela de latência dos 20 turnos.

**F3 — Ferramentas**
> Leia `docs/voz-ia/SPEC.md`. Execute a F3: módulo `voice` na API (worktree a partir de feat/conversation-tabs) com credencial de serviço HMAC, `session-config` e as ferramentas buscar_lead, criar_ou_atualizar_card, agendar ([definição]), enviar_whatsapp e transferir_para_humano reaproveitando as ferramentas existentes; cliente dessas ferramentas no `aline-voz`. TDD, cobertura ≥ 80%, PR aberto sem deploy.

**F4 — Primeira ligação**
> Leia `docs/voz-ia/SPEC.md`. Execute a F4 no número de teste [número/phoneNumberId]: serviço de settings de calling na API (Graph v23+), endpoint admin liga/desliga, tronco de entrada + regra de despacho no LiveKit, webhook do LiveKit para a API e RUNBOOK-ativacao. Confira antes na doc da Meta os campos exatos de `settings` e anote no SPEC. Ative só depois de eu mesclar e fazer o deploy da API.

**F5 — Pós-ligação**
> Leia `docs/voz-ia/SPEC.md`. Execute a F5: migração aditiva em `calls`, gravação por egress no MinIO, transcrição do STT ao vivo, resumo pelo call-insight existente, card de ligação no web com player/transcrição/resumo em tempo real e retenção. Inclua teste de regressão da Sonax. PRs da API e do web abertos, deploy da API antes do web.

**F6 — Ligações de saída**
> Leia `docs/voz-ia/SPEC.md`. Execute a F6: consulta de permissão antes de toda discagem, envio do pedido de permissão com limite, `POST /voice/calls/outbound`, tronco de saída para a Meta no LiveKit, prompt de abertura e o botão "Aline liga" no web. Confira e anote no SPEC os limites e a cobrança da Meta para ligação de saída no Brasil antes de codar.
