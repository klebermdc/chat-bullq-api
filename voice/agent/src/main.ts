import { fileURLToPath } from 'node:url';
import {
  ServerOptions,
  cli,
  defineAgent,
  voice,
  type JobContext,
  type JobProcess,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import { loadConfig } from './config.js';
import { LatencyTracker } from './latency.js';
import { missionFromMetadata } from './missions.js';
import { createLlm, createStt, createTts } from './providers.js';
import { filterSpeechStream } from './speech-filter.js';

const config = loadConfig();

class AlineAgent extends voice.Agent {
  // Todo texto do LLM passa pelo filtro antes do TTS (<think>, markdown, emoji, links).
  async ttsNode(text: ReadableStream<string> | AsyncIterable<string>, modelSettings: voice.ModelSettings) {
    return voice.Agent.default.ttsNode(this, filterSpeechStream(text), modelSettings);
  }
}

function log(evento: string, dados: Record<string, unknown>): void {
  console.log(JSON.stringify({ evento, ts: new Date().toISOString(), ...dados }));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err, (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v)).slice(0, 1500);
  } catch {
    return String(err);
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load({ minSilenceDuration: config.VAD_MIN_SILENCE_MS });
  },
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      stt: createStt(config),
      llm: createLlm(config),
      tts: createTts(config),
      turnHandling: {
        endpointing: { minDelay: config.ENDPOINTING_MIN_DELAY_MS },
        interruption: { enabled: true },
      },
    });

    const latency = new LatencyTracker();
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev) =>
      latency.onUserState(ev.oldState, ev.newState, ev.createdAt),
    );
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      const turn = latency.onAgentState(ev.newState, ev.createdAt);
      if (turn) log('latencia_turno', { sala: ctx.room.name, ...turn });
    });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item as { role?: string; textContent?: string };
      log('fala', { sala: ctx.room.name, quem: item.role, texto: item.textContent });
    });
    session.on(voice.AgentSessionEventTypes.Error, (ev) => log('erro_sessao', { sala: ctx.room.name, erro: describeError((ev as { error?: unknown }).error) }));
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => log('metrica', { ...ev.metrics }));
    ctx.addShutdownCallback(async () => log('latencia_resumo', { sala: ctx.room.name, ...latency.summary() }));

    const mission = missionFromMetadata(ctx.job.metadata);
    await session.start({ agent: new AlineAgent({ instructions: mission.prompt }), room: ctx.room });
    await ctx.connect();
    // Saudação fixa (sem LLM): sai na hora e garante o aviso de gravação.
    // O MiniMax recusa conversa sem fala do cliente ("chat content is empty").
    session.say(mission.greeting);
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: config.AGENT_NAME,
    wsURL: config.LIVEKIT_URL,
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
  }),
);
