#!/usr/bin/env bash
# Atualização final da carteira Umbler (virada do sistema).
#
# Uso, na VPS:
#   bash /opt/chat-ofp/chat-bullq-api/scripts/carteira-umbler/atualizar-carteira.sh /tmp/contatos.csv
#       -> PRÉVIA: mostra o que vai mudar e não grava nada
#   bash /opt/chat-ofp/chat-bullq-api/scripts/carteira-umbler/atualizar-carteira.sh /tmp/contatos.csv --aplicar
#       -> grava
#
# O CSV precisa ter o cabeçalho: telefone,nome,email,vendedor,vendedores_extras,etapa,tags
# O BOM do Excel e as quebras de linha do Windows são tratados aqui.
set -euo pipefail

readonly STACK_DIR=/opt/chat-ofp
readonly SQL_FILE="$(cd "$(dirname "$0")" && pwd)/atualizar-carteira.sql"
readonly EXPECTED_HEADER='telefone,nome,email,vendedor,vendedores_extras,etapa,tags'
readonly WORK_CSV=/tmp/carteira-umbler-atualizacao.csv
readonly CONTAINER_CSV=/tmp/carteira-umbler-atualizacao.csv

CSV="${1:-}"
APLICAR=false
[ "${2:-}" = "--aplicar" ] && APLICAR=true

if [ -z "$CSV" ] || [ ! -f "$CSV" ]; then
  echo "ERRO: informe o CSV. Ex.: bash $0 /tmp/contatos.csv [--aplicar]" >&2
  exit 1
fi
cd "$STACK_DIR"

PG_CONTAINER="$(docker compose ps -q postgres)"
cleanup() {
  rm -f "$WORK_CSV"
  docker exec "$PG_CONTAINER" rm -f "$CONTAINER_CSV" 2>/dev/null || true
}
trap cleanup EXIT

# Cópia de trabalho sem BOM e sem \r: o arquivo original fica intacto.
sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//' "$CSV" > "$WORK_CSV"

HEADER="$(head -1 "$WORK_CSV")"
if [ "$HEADER" != "$EXPECTED_HEADER" ]; then
  echo "ERRO: cabeçalho diferente do esperado." >&2
  echo "  esperado: $EXPECTED_HEADER" >&2
  echo "  veio:     $HEADER" >&2
  exit 1
fi

echo "Arquivo: $CSV ($(($(wc -l < "$WORK_CSV") - 1)) linhas)  |  modo: $([ "$APLICAR" = true ] && echo GRAVAR || echo PRÉVIA)"
docker cp "$WORK_CSV" "$PG_CONTAINER:$CONTAINER_CSV" >/dev/null

docker compose exec -T postgres sh -c \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -v csv=$CONTAINER_CSV -v aplicar=$APLICAR" \
  < "$SQL_FILE"
