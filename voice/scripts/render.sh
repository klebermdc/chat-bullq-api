#!/usr/bin/env bash
# Gera infra/generated/*.yaml a partir dos .tmpl usando o .env.
# Uso: ./scripts/render.sh [arquivo-env]   (padrão: .env)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || { echo "Falta o $ENV_FILE (copie de .env.example)"; exit 1; }
set -a; . "./$ENV_FILE"; set +a
for v in LIVEKIT_API_KEY LIVEKIT_API_SECRET SIP_DOMAIN LIVEKIT_DOMAIN; do
  [ -n "${!v:-}" ] || { echo "Variável $v vazia no $ENV_FILE"; exit 1; }
done
mkdir -p infra/generated
for f in livekit sip; do
  envsubst < "infra/$f.yaml.tmpl" > "infra/generated/$f.yaml"
done
chmod 600 infra/generated/*.yaml
echo "OK: infra/generated/{livekit,sip}.yaml"
