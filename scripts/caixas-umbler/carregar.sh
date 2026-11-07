#!/usr/bin/env bash
# Caixas abertas da Umbler -> conversas abertas no Sendtur.
#
# Uso, na VPS:
#   bash carregar.sh /tmp/caixas.csv              -> PRÉVIA: mostra o que vai mudar e não grava
#   bash carregar.sh /tmp/caixas.csv --aplicar    -> grava
#   bash carregar.sh --desfazer [--aplicar]       -> apaga as conversas importadas que
#                                                    ninguém usou (sem mensagem no Sendtur)
#
# O CSV vem do gerar_csv.py (cabeçalho fixo, ver EXPECTED_HEADER).
set -euo pipefail

readonly STACK_DIR=/opt/chat-ofp
readonly HERE="$(cd "$(dirname "$0")" && pwd)"
readonly EXPECTED_HEADER='umbler_chat_id,telefone,nome,canal_id,aba,vendedor,setor,etiquetas_conversa,etiquetas_contato,ultima_entrada,janela_meta,ultima_msg,criada_em'
readonly CONTAINER_CSV=/tmp/caixas-umbler.csv

APLICAR=false
for a in "$@"; do [ "$a" = "--aplicar" ] && APLICAR=true; done

cd "$STACK_DIR"
PG_CONTAINER="$(docker compose ps -q postgres)"
psql_run() {
  docker compose exec -T postgres sh -c \
    "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -v csv=$CONTAINER_CSV -v aplicar=$APLICAR" \
    < "$1"
}

if [ "${1:-}" = "--desfazer" ]; then
  echo "Desfazer importação  |  modo: $([ "$APLICAR" = true ] && echo GRAVAR || echo PRÉVIA)"
  psql_run "$HERE/desfazer.sql"
  exit 0
fi

CSV="${1:-}"
if [ -z "$CSV" ] || [ ! -f "$CSV" ]; then
  echo "ERRO: informe o CSV. Ex.: bash $0 /tmp/caixas.csv [--aplicar]" >&2
  exit 1
fi
HEADER="$(head -1 "$CSV" | sed -e 's/^\xEF\xBB\xBF//' -e 's/\r$//')"
if [ "$HEADER" != "$EXPECTED_HEADER" ]; then
  echo "ERRO: cabeçalho diferente do esperado." >&2
  echo "  esperado: $EXPECTED_HEADER" >&2
  echo "  veio:     $HEADER" >&2
  exit 1
fi

trap 'docker exec "$PG_CONTAINER" rm -f "$CONTAINER_CSV" 2>/dev/null || true' EXIT
echo "Arquivo: $CSV ($(($(wc -l < "$CSV") - 1)) linhas)  |  modo: $([ "$APLICAR" = true ] && echo GRAVAR || echo PRÉVIA)"
docker cp "$CSV" "$PG_CONTAINER:$CONTAINER_CSV" >/dev/null
psql_run "$HERE/carregar.sql"
