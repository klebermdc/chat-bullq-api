# Runbook — infraestrutura da voz (F1)

Roda em `/opt/voz` na VPS 187.77.213.165 (KVM 4), separado do `/opt/chat-ofp`.
Spec: `docs/voz-ia/SPEC.md` (este repo). Código da voz: pasta `voice/`.

## Peças

| Serviço | Imagem | Porta(s) | Rede |
|---|---|---|---|
| redis (só da voz) | redis:7.4-alpine | 127.0.0.1:6380 | host |
| livekit | livekit/livekit-server:v1.13.11 | 7880 (via Caddy), 7881/tcp, 50000–50200/udp | host |
| sip | livekit/sip:v1.24.0 | 5061/tcp TLS, 5060 só local, 10000–10200/udp | host |
| egress (F5) | livekit/egress:v1.15.0 | — | host, perfil `gravacao` |

Limites de CPU/RAM no `.env` (padrão: 2 CPUs e ~2,8 GB no total).

## Primeira instalação

1. DNS: `A livekit.<domínio>` e `A sip.<domínio>` → 187.77.213.165.
2. Caddy da produção (com OK do Kleber; backup antes: `cp Caddyfile Caddyfile.bak.voz.$(date +%s)`):
   ```
   livekit.<domínio> {
       reverse_proxy 172.19.0.1:7880
   }
   sip.<domínio> {
       respond "ok" 200
   }
   ```
   O bloco `sip.` existe só para o Caddy emitir e renovar o certificado que o SIP usa.
   Recarregar: `docker exec chat-ofp-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
   Conferir que o certificado apareceu em
   `/var/lib/docker/volumes/chat-ofp_caddydata/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/sip.<domínio>/`.
   O Caddy está na rede `chat-ofp_internal` (gateway 172.19.0.1); liberar a 7880 só dessa rede: `ufw allow from 172.19.0.0/16 to any port 7880 proto tcp`.
3. Firewall (com OK do Kleber):
   ```
   ufw allow 5061/tcp
   ufw allow 7881/tcp
   ufw allow 50000:50200/udp
   ufw allow 10000:10200/udp
   ```
4. Código e segredos:
   ```
   mkdir -p /opt/voz && cd /opt/voz   # copiar o repo para cá
   cp .env.example .env && ./scripts/gerar-chaves.sh >> .env   # e preencher domínios
   chmod 600 .env
   ./scripts/render.sh
   docker compose up -d
   ```

## Dia a dia

- Estado: `cd /opt/voz && docker compose ps`
- Logs: `docker compose logs -f sip` (ou `livekit`)
- Parar tudo (produção não é afetada): `docker compose down`
- Mudou o `.env`: `./scripts/render.sh && docker compose up -d`
- Certificado: renovação automática pelo Caddy; depois de renovar, `docker compose restart sip` para recarregar (cron semanal na F4).
- Carga: `docker stats --no-stream` — a voz não passa dos limites; se a inbox ficar lenta, `docker compose down` primeiro, investigar depois.

## Testes de aceite da F1

1. `lk room list --url https://livekit.<domínio> --api-key ... --api-secret ...` responde.
2. `openssl s_client -connect sip.<domínio>:5061 -servername sip.<domínio>` mostra certificado válido.
3. Ligação SIP de teste (softphone com TLS + SRTP SDES, ex. Linphone/Baresip) para um tronco de entrada de teste cria uma sala.
4. No log do `sip`, o SDP negociado tem `opus/48000/2`, `RTP/SAVP` e `a=crypto` (risco R1 da spec).
5. Durante a ligação, `docker stats` e a inbox normais; CPU total < 60%.

## Voltar atrás

`cd /opt/voz && docker compose down`; remover as regras do ufw (`ufw delete allow ...`); restaurar o Caddyfile do backup e dar `caddy reload`.
