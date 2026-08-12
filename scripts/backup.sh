#!/usr/bin/env bash
# Backup do Chat OFP — Postgres + MinIO.
#
# Roda a partir do diretório da stack (onde está o docker-compose.yml), no VPS:
#
#   cd /opt/chat-ofp && ./chat-bullq-api/scripts/backup.sh
#
# Variáveis (do .env da stack, já carregado pelo compose):
#   POSTGRES_USER, POSTGRES_DB, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET
#
# Variáveis deste script:
#   BACKUP_DIR      onde gravar localmente        (default /opt/chat-ofp/_backups)
#   BACKUP_KEEP     quantas cópias diárias manter (default 7)
#   BACKUP_REMOTE   destino REMOTO, obrigatório   (ex.: "s3://meu-bucket/ofp")
#   BACKUP_ALLOW_LOCAL_ONLY=1  pula a exigência de destino remoto (só para teste)
#
# ─────────────────────────────────────────────────────────────────────────────
# Por que o destino remoto é OBRIGATÓRIO
#
# Backup no mesmo VPS que o banco não é backup — é uma segunda cópia do mesmo
# ponto único de falha. Perder o servidor, o disco ou o volume perde os dois
# juntos. Este script FALHA em vez de gravar só local, porque um backup que
# parece existir e não serve é pior que nenhum: ninguém vai procurar outro.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/chat-ofp/_backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_ALLOW_LOCAL_ONLY="${BACKUP_ALLOW_LOCAL_ONLY:-0}"

log() { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

carimbo="$(date +%Y-%m-%d_%H%M)"
destino="$BACKUP_DIR/$carimbo"

# ── 0) Pré-condições ─────────────────────────────────────────────────────────
[ -f docker-compose.yml ] || die "rode a partir do diretório da stack (não achei docker-compose.yml)"

if [ -z "$BACKUP_REMOTE" ] && [ "$BACKUP_ALLOW_LOCAL_ONLY" != "1" ]; then
  die "BACKUP_REMOTE não definido.

   Backup no mesmo VPS que o banco não é backup: perder o servidor perde os
   dois juntos. Defina um destino fora daqui, por exemplo:

     BACKUP_REMOTE=s3://meu-bucket/ofp ./chat-bullq-api/scripts/backup.sh

   Se você REALMENTE quer só a cópia local (teste), use:
     BACKUP_ALLOW_LOCAL_ONLY=1"
fi

: "${POSTGRES_USER:?POSTGRES_USER não definido — carregue o .env da stack}"
: "${POSTGRES_DB:?POSTGRES_DB não definido — carregue o .env da stack}"

mkdir -p "$destino"

# ── 1) Postgres ──────────────────────────────────────────────────────────────
# Formato custom (-Fc): comprimido e restaurável seletivamente com pg_restore.
log "dump do Postgres"
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$destino/postgres.dump" \
  || die "pg_dump falhou"

tamanho="$(wc -c < "$destino/postgres.dump")"
[ "$tamanho" -gt 1000 ] || die "dump saiu com $tamanho bytes — praticamente vazio, algo quebrou"

# Verificação de integridade. Um dump truncado por disco cheio ou pipe quebrado
# gera arquivo com tamanho plausível e só falha na hora do desastre, quando já
# não adianta. `pg_restore --list` lê o índice do arquivo inteiro.
log "conferindo se o dump é legível"
docker compose exec -T postgres pg_restore --list /dev/stdin \
  < "$destino/postgres.dump" > "$destino/postgres.toc" \
  || die "o dump não é legível pelo pg_restore — backup INVÁLIDO, não confie nele"
ok "postgres.dump ($(numfmt --to=iec "$tamanho" 2>/dev/null || echo "$tamanho B")) verificado"

# ── 2) MinIO ─────────────────────────────────────────────────────────────────
# Mídia das conversas e, principalmente, os PDFs de aceite assinado — que têm
# valor jurídico e não são reconstituíveis a partir do banco.
log "espelhando o bucket do MinIO"
docker compose run --rm --entrypoint sh minio-init -c "
  mc alias set local http://minio:9000 '$MINIO_ACCESS_KEY' '$MINIO_SECRET_KEY' >/dev/null &&
  mc mirror --overwrite --remove local/'${MINIO_BUCKET:-chat-uploads}' /backup
" -v "$destino/minio:/backup" 2>/dev/null \
  || die "espelhamento do MinIO falhou"
ok "bucket espelhado"

# ── 3) Empacota ──────────────────────────────────────────────────────────────
log "empacotando"
tar -czf "$destino.tar.gz" -C "$BACKUP_DIR" "$carimbo"
rm -rf "$destino"
pacote="$destino.tar.gz"
ok "$(basename "$pacote") ($(du -h "$pacote" | cut -f1))"

# ── 4) Envia para fora do VPS ────────────────────────────────────────────────
if [ -n "$BACKUP_REMOTE" ]; then
  log "enviando para $BACKUP_REMOTE"
  case "$BACKUP_REMOTE" in
    s3://*)  aws s3 cp "$pacote" "$BACKUP_REMOTE/" || die "upload S3 falhou" ;;
    b2://*|r2://*|*:*)
             rclone copy "$pacote" "$BACKUP_REMOTE" || die "rclone falhou" ;;
    *)       die "BACKUP_REMOTE em formato não reconhecido: $BACKUP_REMOTE" ;;
  esac
  ok "cópia remota confirmada"
else
  printf '\033[1;33m   ⚠ só cópia LOCAL — isto não protege contra perda do VPS\033[0m\n'
fi

# ── 5) Retenção ──────────────────────────────────────────────────────────────
# Só depois do upload: apagar o antigo antes de confirmar o novo é como ficar
# sem rede entre um trapézio e outro.
log "retenção: mantendo os $BACKUP_KEEP mais recentes"
ls -1t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r velho; do
  rm -f "$velho" && echo "   removido $(basename "$velho")"
done

ok "BACKUP CONCLUÍDO — $(basename "$pacote")"
echo
echo "   Para restaurar, veja: chat-bullq-api/docs/runbook-backup-restore.md"
echo "   Um backup nunca testado não é um backup. Agende a restauração."
