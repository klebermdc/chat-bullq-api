#!/usr/bin/env bash
# Baixa os modelos (se faltarem) e mede STT/TTS do Speaches pela rede interna.
# Uso na VPS: cd /opt/voz && ./scripts/teste-speaches.sh
# Gera /opt/voz/amostras/<voz>.wav para ouvir.
set -euo pipefail
cd "$(dirname "$0")/.."
# Modelos passados na linha de comando têm prioridade sobre o .env.
ARG_STT="${STT_MODEL:-}"; ARG_TTS="${TTS_MODEL:-}"
set -a; . ./.env; set +a
STT_MODEL="${ARG_STT:-${STT_MODEL:-Systran/faster-whisper-small}}"
TTS_MODEL="${ARG_TTS:-${TTS_MODEL:-speaches-ai/Kokoro-82M-v1.0-ONNX}}"
VOZES="${VOZES:-pf_dora pm_alex pm_santa}"
FRASE="${FRASE:-Olá! Aqui é a Aline, da Orlando Fast Pass. Você está pensando em viajar para Orlando em qual mês?}"
mkdir -p amostras

curl_ia() {
  docker run --rm --user 0 --network voz_voz_ia -v /opt/voz/amostras:/a curlimages/curl:8.11.1 \
    -s -H "Authorization: Bearer ${SPEACHES_API_KEY}" "$@"
}

for m in "$STT_MODEL" "$TTS_MODEL"; do
  echo "modelo $m: HTTP $(curl_ia -o /dev/null -w '%{http_code}' --max-time 900 -X POST "http://speaches:8000/v1/models/$m")"
done

for v in $VOZES; do
  body=$(printf '{"model":"%s","voice":"%s","input":"%s","response_format":"wav","speed":1.0}' "$TTS_MODEL" "$v" "$FRASE")
  t=$(curl_ia -o "/a/$v.wav" -w '%{time_starttransfer} %{time_total}' --max-time 120 \
      -H 'Content-Type: application/json' -d "$body" http://speaches:8000/v1/audio/speech)
  echo "TTS $v: 1º byte ${t% *}s | total ${t#* }s | $(stat -c %s "amostras/$v.wav") bytes"
done

# Volta da fala para texto (STT), 2x: a 1ª aquece o modelo.
for i in 1 2; do
  out=$(curl_ia -w '\n%{time_total}' --max-time 120 -F "file=@/a/pf_dora.wav" -F "model=$STT_MODEL" \
        -F language=pt -F response_format=json http://speaches:8000/v1/audio/transcriptions)
  echo "STT rodada $i: $(echo "$out" | tail -1)s → $(echo "$out" | head -1)"
done
