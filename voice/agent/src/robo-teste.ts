/**
 * Robô de teste de ponta a ponta (não roda em produção).
 * Entra numa sala nova com a Aline despachada, fala cada WAV uma vez com pausa
 * entre elas e sai. A latência por turno sai no log do agente (latencia_turno).
 *
 * Uso: node dist/robo-teste.js /amostras/q1.wav /amostras/q2.wav ...
 * Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, AGENT_NAME
 */
import { readFileSync } from 'node:fs';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { AccessToken, AgentDispatchClient } from 'livekit-server-sdk';

const FRAME_MS = 20;
const WAIT_GREETING_MS = 9000;
const WAIT_REPLY_MS = 16000;

interface Pcm {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
}

function readWav(path: string): Pcm {
  const buf = readFileSync(path);
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    // WAV gerado em streaming pode vir com tamanho 0xFFFFFFFF: limita ao que existe.
    const size = Math.min(buf.readUInt32LE(offset + 4), buf.length - offset - 8);
    if (id === 'data') {
      const data = buf.subarray(offset + 8, offset + 8 + size);
      return { samples: new Int16Array(Uint8Array.from(data).buffer, 0, Math.floor(data.length / 2)), sampleRate, channels };
    }
    offset += 8 + size;
  }
  throw new Error(`WAV sem bloco de dados: ${path}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function speak(source: AudioSource, pcm: Pcm): Promise<void> {
  const perFrame = (pcm.sampleRate * FRAME_MS) / 1000;
  for (let i = 0; i < pcm.samples.length; i += perFrame * pcm.channels) {
    const chunk = new Int16Array(perFrame * pcm.channels);
    chunk.set(pcm.samples.subarray(i, i + perFrame * pcm.channels));
    await source.captureFrame(new AudioFrame(chunk, pcm.sampleRate, pcm.channels, perFrame));
  }
}

async function silence(source: AudioSource, sampleRate: number, ms: number): Promise<void> {
  const perFrame = (sampleRate * FRAME_MS) / 1000;
  for (let t = 0; t < ms; t += FRAME_MS) {
    await source.captureFrame(new AudioFrame(new Int16Array(perFrame), sampleRate, 1, perFrame));
  }
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('Passe ao menos um WAV');
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) throw new Error('Faltam LIVEKIT_*');
  const agentName = process.env.AGENT_NAME ?? 'aline-voz';
  const room = `robo-${Date.now()}`;
  const httpUrl = LIVEKIT_URL.replace(/^ws/, 'http');

  await new AgentDispatchClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).createDispatch(room, agentName);
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: 'robo', ttl: '10m' });
  at.addGrant({ roomJoin: true, room });
  const lk = new Room();
  await lk.connect(LIVEKIT_URL, await at.toJwt(), { autoSubscribe: true, dynacast: false });

  const pcms = files.map(readWav);
  const rate = pcms[0].sampleRate;
  const source = new AudioSource(rate, 1);
  const track = LocalAudioTrack.createAudioTrack('microfone', source);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await lk.localParticipant!.publishTrack(track, opts);
  console.log(JSON.stringify({ robo: 'na sala', room }));

  await silence(source, rate, WAIT_GREETING_MS);
  for (const [i, pcm] of pcms.entries()) {
    console.log(JSON.stringify({ robo: 'falando', pergunta: i + 1 }));
    await speak(source, pcm);
    await silence(source, rate, WAIT_REPLY_MS);
  }
  await lk.disconnect();
  console.log(JSON.stringify({ robo: 'saiu', room }));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
