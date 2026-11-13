import { stt, tts, type JobContext, type VAD } from '@livekit/agents';
import {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type RemoteTrack,
} from '@livekit/rtc-node';
import { waitUntilAnswered } from './answer-wait.js';
import type { SendturVoiceClient } from './sendtur-client.js';
import { CLIENT_IDENTITY, RECORDING_NOTICE, speakerOf, TranscriptCollector } from './transcript.js';

/**
 * Ligação de vendedor: o agente fica calado na sala. Quando o cliente atende,
 * toca o aviso de gravação; depois transcreve cliente e vendedor e, no fim,
 * manda tudo para a API (que grava e gera o resumo).
 */
const ANSWER_TIMEOUT_MS = 60_000;
/** Depois do fim, espera as últimas falas saírem do STT. */
const FLUSH_TIMEOUT_MS = 8_000;

export interface TranscriberDeps {
  ctx: JobContext;
  callId: string;
  stt: stt.STT;
  vad: VAD;
  tts: tts.TTS;
  client: SendturVoiceClient;
  log: (evento: string, dados: Record<string, unknown>) => void;
}

async function playNotice(ctx: JobContext, voice: tts.TTS): Promise<void> {
  const source = new AudioSource(voice.sampleRate, voice.numChannels);
  const track = LocalAudioTrack.createAudioTrack('aviso-gravacao', source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  const publication = await ctx.room.localParticipant!.publishTrack(track, options);
  try {
    for await (const audio of voice.synthesize(RECORDING_NOTICE)) await source.captureFrame(audio.frame);
    await source.waitForPlayout();
  } finally {
    await ctx.room.localParticipant!.unpublishTrack(publication.sid!);
  }
}

/** Transcreve uma trilha de áudio até ela acabar; devolve quando o STT esvaziar. */
function transcribeTrack(track: RemoteTrack, quem: ReturnType<typeof speakerOf>, deps: TranscriberDeps, collector: TranscriptCollector) {
  const recognizer = new stt.StreamAdapter(deps.stt, deps.vad).stream();
  const pump = (async () => {
    for await (const frame of new AudioStream(track)) recognizer.pushFrame(frame);
    recognizer.endInput();
  })().catch((err) => deps.log('erro_transcricao', { quem, erro: (err as Error).message }));
  const read = (async () => {
    for await (const ev of recognizer) {
      if (ev.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
      collector.add(quem, ev.alternatives?.[0]?.text ?? '', Date.now());
    }
  })().catch((err) => deps.log('erro_transcricao', { quem, erro: (err as Error).message }));
  return {
    stop: () => recognizer.endInput(),
    done: Promise.all([pump, read]),
  };
}

export async function runTranscriber(deps: TranscriberDeps): Promise<void> {
  const { ctx, callId, client, log } = deps;
  const collector = new TranscriptCollector();
  const tracks: ReturnType<typeof transcribeTrack>[] = [];
  let finished = false;

  const finish = async () => {
    if (finished) return;
    finished = true;
    tracks.forEach((t) => t.stop());
    await Promise.race([Promise.all(tracks.map((t) => t.done)), new Promise((r) => setTimeout(r, FLUSH_TIMEOUT_MS))]);
    const payload = collector.payload(callId, Date.now());
    log('transcricao_fim', { sala: ctx.room.name, callId, atendeu: payload.answered, falas: payload.segments.length, segundos: payload.durationSec });
    await client.callTranscript(payload).catch((err) => log('erro_transcricao', { callId, erro: (err as Error).message }));
  };
  ctx.addShutdownCallback(finish);

  ctx.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: unknown, participant: RemoteParticipant) => {
    if (track.kind !== TrackKind.KIND_AUDIO || finished) return;
    tracks.push(transcribeTrack(track, speakerOf(participant.identity), deps, collector));
  });
  ctx.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    if (participant.identity === CLIENT_IDENTITY) ctx.shutdown('cliente desligou');
  });

  await ctx.connect();
  log('transcricao_inicio', { sala: ctx.room.name, callId });
  const cliente = await ctx.waitForParticipant(CLIENT_IDENTITY);
  if (!(await waitUntilAnswered(ctx.room, cliente, ANSWER_TIMEOUT_MS))) {
    ctx.shutdown('cliente não atendeu');
    return;
  }
  collector.markAnswered(Date.now());
  await playNotice(ctx, deps.tts).catch((err) => log('erro_aviso', { callId, erro: (err as Error).message }));
}
