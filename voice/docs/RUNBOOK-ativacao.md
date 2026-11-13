# Runbook — ativar as ligações da Aline (F6)

Hoje tudo está **desligado**: a chave "Ligações da Aline" vem desligada por agência e,
mesmo ligada, a API não disca sem a configuração do LiveKit. Esta é a ordem para ligar
de verdade. Cada passo é reversível.

## Estado (13/11/2026)

- Passos 1, 2 e 3 **feitos** no 5198-4190 (calling + SIP SDES ligados, ícone de ligar **escondido** com `call_icon_visibility: DISABLE_ALL`; troncos `meta-whatsapp-saida`/`meta-whatsapp-entrada`; `LIVEKIT_*` na API).
- **Primeira ligação real OK** para um número da equipe (permissão permanente): autenticou (407 → reenvio), áudio OPUS/SRTP, Aline conduziu a missão, cliente desligou (`bye`).
- Chave "Ligações da Aline" ainda **desligada** — ligar só quando decidido.
- Para mostrar o ícone de ligar aos clientes (ligação de entrada): `call_icon_visibility: DEFAULT`.

**Pegadinha resolvida:** a Meta recusa o ALPN `sip` do livekit/sip (`tls: no application protocol`).
O `sip.yaml` precisa de `tls.alpn: []` (já no template).

**Pegadinha 2 (13/11):** a Meta às vezes recusa a ligação antes de tocar com
`403: SDP Validation Error` (mesma configuração passou antes e depois). A API disca
esperando os primeiros 4 s da resposta e, nesse caso, disca de novo uma vez
(Aline em sala nova `<sala>-2`; vendedor na mesma sala). Aparece no log como
"Meta recusou o SDP na sala …".

## 0. Antes de começar

- Horário de atendimento dos vendedores conferido (a Aline só liga no expediente do dono da conversa).
- Agenda no ar (PR API #308 / web #301) — é onde a Aline marca o retorno.
- Lembrar: ativar o calling no número **mostra o botão de ligar para todos os clientes** desse número.

## 1. Ativar o calling + SIP no número (Meta)

Pela API do Sendtur, como dono/admin (canal do 5198-4190):

```
POST /api/v1/voice/settings/whatsapp-calling
{ "channelId": "<id do canal>", "enabled": true }
```

Isso manda à Meta `calling.status=ENABLED`, `callback_permission_status=ENABLED`,
`srtp_key_exchange_protocol=SDES` e `sip.servers=[{ hostname: sip.sendtur.com.br, port: 5061 }]`.
Voltar atrás: o mesmo POST com `"enabled": false`.

Depois, pegar a senha SIP gerada pela Meta (não fica no Sendtur):

```
GET https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/settings?include_sip_credentials=true
```

→ campo `sip_user_password`.

## 2. Troncos no LiveKit (VPS, /opt/voz)

Com a `lk` CLI em container (como no teste da F1):

- **Entrada** (cliente liga para o número): tronco com o número (`+55…`), usuário = número da empresa
  normalizado, senha = `sip_user_password`, `media_encryption: SIP_MEDIA_ENCRYPT_REQUIRE`;
  regra de despacho para sala individual com o agente `aline-voz`.
- **Saída** (Aline liga): tronco de saída com `address: wa.meta.vc`, `transport: TLS`,
  `numbers: ["+55<número da empresa>"]`, `auth_username: <número da empresa>`,
  `auth_password: <sip_user_password>`, `media_encryption: SIP_MEDIA_ENCRYPT_REQUIRE`.
  Anotar o id `ST_…` do tronco de saída.

Obs. da Meta: o domínio do `From` precisa bater com o hostname SIP configurado
(`sip.sendtur.com.br`) — conferir no primeiro teste.

## 3. Variáveis da API (/opt/chat-ofp)

No `.env` e mapeadas no `docker-compose.override.yml` (seção `api.environment`):

```
LIVEKIT_URL=https://livekit.sendtur.com.br
LIVEKIT_API_KEY=<do /opt/voz/.env>
LIVEKIT_API_SECRET=<do /opt/voz/.env>
LIVEKIT_SIP_OUTBOUND_TRUNK_ID=ST_…
```

Deploy da API. Em Configurações → Ligações da Aline o aviso "conexão ainda não configurada" some.

## 4. Primeiro teste (antes de ligar para clientes)

1. Mandar uma cotação para um número de teste da equipe, responder "permitir" no pedido de permissão.
2. Ligar a chave com prazo de 12 h (ou ajustar a cotação de teste no banco para ser antiga).
3. Conferir na tabela `voice_outreach` o `call_status` (`LIGOU`, `SEM_PERMISSAO`, `FALHOU` + `call_note`).
4. Atender: a Aline só fala quando atendem; marcar um retorno; conferir na Agenda e na conversa.

## 5. Ligar para os clientes

Configurações → **Ligações da Aline** → ligar. Para parar na hora: desligar a mesma chave
(a varredura de 5 em 5 min deixa de agir na próxima rodada).

## Limites da Meta (conferidos em 13/11/2026)

- Pedido de permissão: 1 por dia e 2 por semana por cliente; mensagem comum só com janela aberta.
- Permissão temporária dura 7 dias; 4 ligações seguidas sem atender revogam a permissão.
- Até 100 ligações atendidas por dia por número.
- A Aline faz **uma** tentativa por cotação.
