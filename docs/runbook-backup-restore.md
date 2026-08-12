# Runbook — backup e restauração

Fecha o **V8** da auditoria técnica: até aqui a única referência a backup era um
`pg_dump` avulso documentado no `DEPLOY.md`. Sem cron, sem retenção, sem cópia
fora do VPS, sem teste de restauração — e o MinIO (mídia e **PDFs de aceite
assinado**, que têm valor jurídico e não são reconstituíveis a partir do banco)
sem backup nenhum.

É o único risco da auditoria em que a falha **não tem volta**.

---

## O que o backup cobre

| Dado | Onde vive | No backup |
|---|---|---|
| Conversas, contatos, pedidos, aceites | volume `pgdata` | `postgres.dump` (formato custom) |
| Mídia das conversas | volume `miniodata` | `minio/` espelhado |
| PDFs de aceite assinado | volume `miniodata`, prefixo `acceptances/` | `minio/acceptances/` |
| Filas em andamento | volume `redisdata` | **não** — ver "O que fica de fora" |

### O que fica de fora, de propósito

O **Redis** não entra. Ele guarda fila de automação e cadência em voo, que são
estado transitório: restaurar uma fila de dias atrás reenviaria mensagem já
enviada para o cliente. Perder a fila custa alguns disparos atrasados; restaurar
fila velha custa cliente recebendo cadência repetida.

---

## Instalação no VPS

### 1. Destino remoto (obrigatório)

O script **falha** se não houver destino remoto. Backup no mesmo VPS que o banco
não é backup: perder o servidor perde os dois juntos.

Escolha um provedor fora da Hostinger e configure as credenciais:

```bash
# Opção A — S3 / Cloudflare R2 / Backblaze via aws-cli
apt-get install -y awscli
aws configure   # ou use variáveis AWS_* no ambiente do cron

# Opção B — qualquer destino via rclone
curl https://rclone.org/install.sh | bash
rclone config
```

### 2. Primeira execução, à mão

```bash
cd /opt/chat-ofp
set -a; . ./.env; set +a          # carrega POSTGRES_*, MINIO_*
BACKUP_REMOTE=s3://SEU-BUCKET/ofp ./chat-bullq-api/scripts/backup.sh
```

Confira na saída: `postgres.dump verificado`, `bucket espelhado`,
`cópia remota confirmada`.

### 3. Cron diário

```bash
cat >/etc/cron.d/chat-ofp-backup <<'EOF'
SHELL=/bin/bash
0 3 * * * root cd /opt/chat-ofp && set -a && . ./.env && set +a && BACKUP_REMOTE=s3://SEU-BUCKET/ofp BACKUP_KEEP=7 ./chat-bullq-api/scripts/backup.sh >>/var/log/chat-ofp-backup.log 2>&1
EOF
```

3h da manhã: fora do horário de atendimento e depois da virada de dia, para o
dump fechar o dia inteiro.

### 4. Alerta quando falhar

Backup que falha em silêncio é o mesmo que não ter backup — só que com a falsa
sensação de segurança. Faça o cron gritar:

```bash
0 3 * * * root cd /opt/chat-ofp && ... || curl -s -X POST \
  "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d chat_id="$TELEGRAM_CHAT_ID" -d text="🔴 BACKUP DO CHAT OFP FALHOU"
```

---

## Restauração

> **Leia inteiro antes de executar.** A restauração do Postgres é destrutiva.

### Postgres

```bash
cd /opt/chat-ofp
tar -xzf _backups/2026-08-12_0300.tar.gz -C /tmp

# 1. Derrube a API para ninguém escrever durante a restauração.
docker compose stop api

# 2. Restaure. --clean --if-exists derruba os objetos antes de recriar.
docker compose exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < /tmp/2026-08-12_0300/postgres.dump

# 3. Suba de volta.
docker compose start api
```

### MinIO

```bash
docker compose run --rm --entrypoint sh \
  -v /tmp/2026-08-12_0300/minio:/restore minio-init -c "
    mc alias set local http://minio:9000 \"\$MINIO_ACCESS_KEY\" \"\$MINIO_SECRET_KEY\" &&
    mc mirror --overwrite /restore local/\$MINIO_BUCKET
  "
```

### Depois de restaurar, confira

- [ ] `curl -s https://api-ofpchat.explotek.pro/api/v1/health` responde `ok`
- [ ] o inbox abre e mostra conversas
- [ ] uma imagem antiga de conversa carrega (prova que o MinIO voltou)
- [ ] um PDF de aceite assinado abre pelo painel

---

## Teste de restauração — não pule

**Um backup nunca testado não é um backup.** Ele é uma hipótese.

Agende **trimestralmente**: restaure o backup mais recente num Postgres
descartável e confira que os dados estão lá.

```bash
docker run -d --name pg-teste -e POSTGRES_PASSWORD=teste -p 55432:5432 postgres:16-alpine
sleep 5
pg_restore -h localhost -p 55432 -U postgres -d postgres --clean --if-exists \
  < /tmp/BACKUP/postgres.dump

psql -h localhost -p 55432 -U postgres -c \
  "select (select count(*) from conversations) conversas,
          (select count(*) from messages) mensagens,
          (select count(*) from order_acceptances) aceites;"

docker rm -f pg-teste
```

Se as contagens baterem com produção, o backup serve. Anote a data do último
teste bem-sucedido — é a única métrica que importa aqui.

---

## Limitações conhecidas

- **RPO de 24h.** Um desastre às 2h da manhã perde o dia inteiro de conversas.
  Reduzir isso exige WAL archiving contínuo (`pg_receivewal` ou um Postgres
  gerenciado), que é uma fatia própria.
- **O dump é feito com a API no ar.** `pg_dump` usa snapshot transacional, então
  o dump é consistente; mas escrita durante o dump não entra nele.
- **Não é cifrado em repouso.** Se o destino remoto não for privado por padrão,
  o pacote leva PII de cliente. Verifique a política do bucket.
