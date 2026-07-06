#!/usr/bin/env bash
#
# Cria um canal WHATSAPP_OFFICIAL (Meta Cloud API) via API do Chat OFP.
# Modo interativo: pergunta cada valor (segredos ficam ocultos). Também aceita
# variáveis de ambiente (EMAIL, PASSWORD, ACCESS_TOKEN, APP_SECRET,
# PHONE_NUMBER_ID, BUSINESS_ACCOUNT_ID, VERIFY_TOKEN, ORG_ID, BASE_URL).
#
# Uso:  bash scripts/create-wa-official-channel.sh
#
set -uo pipefail

BASE_URL="${BASE_URL:-https://api-ofpchat.explotek.pro/api/v1}"   # local: http://localhost:3001/api/v1

fail() { echo "ERRO: $*" >&2; exit 1; }

# Pergunta um valor visível, com default opcional (Enter aceita o default).
ask() {
  local prompt="$1" def="${2:-}" val=""
  if [ -n "$def" ]; then
    read -r -p "$prompt [$def]: " val </dev/tty
    printf '%s' "${val:-$def}"
  else
    read -r -p "$prompt: " val </dev/tty
    printf '%s' "$val"
  fi
}

# Pergunta um segredo (não ecoa na tela).
ask_secret() {
  local prompt="$1" val=""
  read -r -s -p "$prompt: " val </dev/tty
  echo >&2
  printf '%s' "$val"
}

echo "== Criar canal WHATSAPP_OFFICIAL (Meta Cloud API) =="
echo "   Alvo: $BASE_URL"
echo

EMAIL="${EMAIL:-$(ask 'E-mail de login' 'contato@orlandofastpass.com.br')}"
PASSWORD="${PASSWORD:-$(ask_secret 'Senha do painel (oculta)')}"
ACCESS_TOKEN="${ACCESS_TOKEN:-$(ask_secret 'Meta ACCESS_TOKEN do System User (oculto)')}"
APP_SECRET="${APP_SECRET:-$(ask_secret 'Meta APP_SECRET (oculto)')}"
PHONE_NUMBER_ID="${PHONE_NUMBER_ID:-$(ask 'Phone number ID' '1234285886433709')}"
BUSINESS_ACCOUNT_ID="${BUSINESS_ACCOUNT_ID:-$(ask 'WABA / Business Account ID' '1555266886130555')}"
VERIFY_TOKEN="${VERIFY_TOKEN:-$(ask 'Verify token (o mesmo vai na Meta)' 'ofp-wpp-2026')}"
CHANNEL_NAME="${CHANNEL_NAME:-WhatsApp Oficial}"
VISIBILITY="${VISIBILITY:-ORG}"
ORG_ID="${ORG_ID:-}"

[ -n "$PASSWORD" ]            || fail "senha vazia"
[ -n "$ACCESS_TOKEN" ]       || fail "ACCESS_TOKEN vazio"
[ -n "$APP_SECRET" ]         || fail "APP_SECRET vazio"
[ -n "$PHONE_NUMBER_ID" ]    || fail "PHONE_NUMBER_ID vazio"
[ -n "$BUSINESS_ACCOUNT_ID" ]|| fail "BUSINESS_ACCOUNT_ID vazio"

extract_token() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.accessToken // .access_token // empty'
  else
    grep -o '"accessToken"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/'
  fi
}

echo
echo ">> Login em $BASE_URL/auth/login ..."
LOGIN_RESP="$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

JWT="$(printf '%s' "$LOGIN_RESP" | extract_token)"
[ -n "$JWT" ] || fail "login falhou / sem accessToken. Resposta: $LOGIN_RESP"
echo ">> JWT obtido."

# Resolve ORG_ID a partir do login se não foi informado (prefere org OWNER/ADMIN).
if [ -z "$ORG_ID" ]; then
  if command -v jq >/dev/null 2>&1; then
    ORG_ID="$(printf '%s' "$LOGIN_RESP" | jq -r '([.organizations[] | select(.role=="OWNER" or .role=="ADMIN")][0] // .organizations[0]) | .id // empty')"
    ORG_NAME="$(printf '%s' "$LOGIN_RESP" | jq -r '([.organizations[] | select(.role=="OWNER" or .role=="ADMIN")][0] // .organizations[0]) | .name // empty')"
    ORG_COUNT="$(printf '%s' "$LOGIN_RESP" | jq -r '.organizations | length')"
  else
    # sem jq: isola o array "organizations" primeiro, senão pegaria o "id" do usuário
    ORG_ID="$(printf '%s' "$LOGIN_RESP" \
      | sed 's/.*"organizations"[[:space:]]*:[[:space:]]*\[[[:space:]]*{//' \
      | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 \
      | sed 's/.*:[[:space:]]*"\([^"]*\)".*/\1/')"
    ORG_NAME="(sem jq — não exibido)"
    ORG_COUNT="?"
  fi
  [ -n "$ORG_ID" ] || fail "não consegui resolver ORG_ID do login. Resposta: $LOGIN_RESP"
  echo ">> Org resolvida automaticamente: $ORG_NAME ($ORG_ID)"
  [ "$ORG_COUNT" != "1" ] && [ "$ORG_COUNT" != "?" ] && echo "   (você tem $ORG_COUNT orgs; se for a errada, rode com ORG_ID=... explícito)"
fi

echo ">> Criando canal WHATSAPP_OFFICIAL ..."
BODY=$(cat <<JSON
{
  "type": "WHATSAPP_OFFICIAL",
  "name": "$CHANNEL_NAME",
  "config": {
    "accessToken": "$ACCESS_TOKEN",
    "phoneNumberId": "$PHONE_NUMBER_ID",
    "businessAccountId": "$BUSINESS_ACCOUNT_ID",
    "appSecret": "$APP_SECRET",
    "verifyToken": "$VERIFY_TOKEN"
  },
  "visibility": "$VISIBILITY"
}
JSON
)

curl -sS -X POST "$BASE_URL/channels" \
  -H "Authorization: Bearer $JWT" \
  -H "x-organization-id: $ORG_ID" \
  -H 'Content-Type: application/json' \
  -d "$BODY" | { command -v jq >/dev/null 2>&1 && jq . || cat; }

echo
echo ">> Pronto. Se retornou o canal com id, o verify token é: $VERIFY_TOKEN"
echo ">> Use esse mesmo verify token e a Callback URL na Meta."
