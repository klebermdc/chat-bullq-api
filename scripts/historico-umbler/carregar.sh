#!/usr/bin/env bash
# Carga do histórico da Umbler (conversas de 2025–2026) nas tabelas
# umbler_historico_*. Precisa da migration 20261026120000_umbler_historico.
#
# Uso, na VPS:
#   bash /opt/chat-ofp/chat-bullq-api/scripts/historico-umbler/carregar.sh <org_id> /tmp/carga
#       -> PRÉVIA: relatório de casamento por telefone, não grava nada
#   bash /opt/chat-ofp/chat-bullq-api/scripts/historico-umbler/carregar.sh <org_id> /tmp/carga --aplicar
#       -> grava
#
# A pasta precisa ter conversas.csv e mensagens.csv gerados pelo
# preparar_csv.py do backup (~/dev/backups/umbler-historico-20261023).
set -euo pipefail

readonly STACK_DIR=/opt/chat-ofp
readonly SQL_FILE="$(cd "$(dirname "$0")" && pwd)/carregar.sql"
readonly CONV_HEADER='id,telefone,contato_nome,canal_nome,setor_nome,etiquetas,atendentes,criada_em,ultima_msg_em'
readonly MSG_HEADER='id,conversa_id,enviada_em,origem,tipo,conteudo,autor,arquivo_url,arquivo_nome,arquivo_tipo,privada'
readonly CONTAINER_DIR=/tmp/historico-umbler

ORG="${1:-}"
DIR="${2:-}"
APLICAR=false
[ "${3:-}" = "--aplicar" ] && APLICAR=true

if [ -z "$ORG" ] || [ -z "$DIR" ] || [ ! -f "$DIR/conversas.csv" ] || [ ! -f "$DIR/mensagens.csv" ]; then
  echo "ERRO: uso: bash $0 <org_id> <pasta com conversas.csv e mensagens.csv> [--aplicar]" >&2
  exit 1
fi

if [[ ! "$ORG" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "ERRO: org_id inválido: $ORG" >&2
  exit 1
fi

check_header() {
  local file="$1" expected="$2" got
  got="$(head -1 "$file" | sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//')"
  if [ "$got" != "$expected" ]; then
    echo "ERRO: cabeçalho de $file diferente do esperado." >&2
    echo "  esperado: $expected" >&2
    echo "  veio:     $got" >&2
    exit 1
  fi
}
check_header "$DIR/conversas.csv" "$CONV_HEADER"
check_header "$DIR/mensagens.csv" "$MSG_HEADER"

cd "$STACK_DIR"
PG_CONTAINER="$(docker compose ps -q postgres)"
cleanup() {
  docker exec "$PG_CONTAINER" rm -rf "$CONTAINER_DIR" 2>/dev/null || true
}
trap cleanup EXIT

echo "Pasta: $DIR  |  org: $ORG  |  modo: $([ "$APLICAR" = true ] && echo GRAVAR || echo PRÉVIA)"
docker exec "$PG_CONTAINER" mkdir -p "$CONTAINER_DIR"
docker cp "$DIR/conversas.csv" "$PG_CONTAINER:$CONTAINER_DIR/conversas.csv" >/dev/null
docker cp "$DIR/mensagens.csv" "$PG_CONTAINER:$CONTAINER_DIR/mensagens.csv" >/dev/null

docker compose exec -T postgres sh -c \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -v org=$ORG \
     -v conv_csv=$CONTAINER_DIR/conversas.csv -v msg_csv=$CONTAINER_DIR/mensagens.csv -v aplicar=$APLICAR" \
  < "$SQL_FILE"
