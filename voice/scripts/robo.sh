cd /opt/voz; set -a; . ./.env; set +a
for i in $(seq 1 40); do docker compose logs --since 3m agent 2>&1 | grep -q "registered worker" && break; sleep 2; done; sleep 3
T0=$(date -u +%Y-%m-%dT%H:%M:%S)
timeout 120 docker run --rm --network voz_voz_ia -v /opt/voz/amostras:/amostras -e LIVEKIT_URL=wss://$LIVEKIT_DOMAIN -e LIVEKIT_API_KEY=$LIVEKIT_API_KEY -e LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET voz-agent:local node dist/robo-teste.js /amostras/q1.wav /amostras/q2.wav /amostras/q3.wav 2>&1 | grep -E "Error" | cut -c1-150
sleep 4
docker compose logs --since $T0 agent 2>&1 | grep -E "\"evento\":\"(metrica|latencia_turno|fala|erro_sessao)\"|level\":50" | python3 -c "
import sys,json
for l in sys.stdin:
  try: j=json.loads(l.split('| ',1)[-1])
  except: continue
  t=j.get('type',j.get('evento') or j.get('msg'))
  if t=='fala':
    if j.get('quem'): print('   ',j.get('quem'),':',str(j.get('texto'))[:120])
    continue
  if t=='erro_sessao' or j.get('level')==50: print('ERRO', str(j.get('erro') or j.get('error'))[:400]); continue
  if t not in ('stt_metrics','llm_metrics','latencia_turno','eou_metrics'): 
    if t=='tts_metrics': pass
    else: continue
  keep={k:(round(v) if isinstance(v,float) else v) for k,v in j.items() if k in ('ms','turno','durationMs','ttftMs','ttfbMs','endOfUtteranceDelayMs')}
  print(t.ljust(14), keep)
"
