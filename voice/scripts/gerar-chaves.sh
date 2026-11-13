#!/usr/bin/env bash
# Gera um par de chaves para o LiveKit. Cole o resultado no .env.
set -euo pipefail
echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
echo "LIVEKIT_API_SECRET=$(openssl rand -base64 36 | tr -d '/+=\n')"
