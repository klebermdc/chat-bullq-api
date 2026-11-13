import Anthropic from '@anthropic-ai/sdk';
import * as anthropic from '@livekit/agents-plugin-anthropic';
import * as openai from '@livekit/agents-plugin-openai';
import OpenAI from 'openai';
import { createExtraBodyFetch, createSerialFetch } from './serial-fetch.js';
import { StreamingTTS } from './streaming-tts.js';

/** Tipo de fetch que o SDK da Anthropic aceita (ele declara tipos próprios de Request). */
type AnthropicFetch = NonNullable<NonNullable<ConstructorParameters<typeof Anthropic>[0]>['fetch']>;
import type { VoiceConfig } from './config.js';

/**
 * Fábrica dos provedores. Hoje todos falam a API da OpenAI (Speaches, MiniMax,
 * Qwen3-TTS via servidor compatível). Outro tipo de provedor entra aqui sem
 * mexer no agente.
 */
export function createStt(cfg: VoiceConfig) {
  return new openai.STT({
    baseURL: cfg.STT_BASE_URL,
    apiKey: cfg.STT_API_KEY,
    model: cfg.STT_MODEL,
    language: cfg.STT_LANGUAGE,
    detectLanguage: false,
    // Envio simples do trecho cortado pelo VAD (Speaches não fala o modo realtime da OpenAI).
    useRealtime: false,
  });
}

export function createTts(cfg: VoiceConfig) {
  // Uma frase por vez no TTS: a 1ª frase não disputa CPU com as seguintes.
  const client = new OpenAI({ baseURL: cfg.TTS_BASE_URL, apiKey: cfg.TTS_API_KEY, fetch: createSerialFetch({ extraBody: cfg.TTS_EXTRA_BODY }) });
  // TTS próprio: toca cada pedaço de áudio assim que chega (o plugin oficial espera a frase inteira).
  return new StreamingTTS({ client, model: cfg.TTS_MODEL, voice: cfg.TTS_VOICE, speed: cfg.TTS_SPEED });
}

export function createLlm(cfg: VoiceConfig) {
  if (cfg.LLM_PROVIDER === 'anthropic') {
    // SDK oficial da Anthropic; o fetch acrescenta LLM_EXTRA_BODY (ex.: effort baixo para voz).
    // Sem temperature: os modelos Claude atuais recusam o parâmetro.
    const fetchWithExtras = createExtraBodyFetch(cfg.LLM_EXTRA_BODY) as unknown as AnthropicFetch;
    const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, fetch: fetchWithExtras });
    return new anthropic.LLM({ client, model: cfg.LLM_MODEL, maxTokens: 1024 });
  }
  return new openai.LLM({
    baseURL: cfg.LLM_BASE_URL,
    apiKey: cfg.LLM_API_KEY,
    model: cfg.LLM_MODEL,
    temperature: cfg.LLM_TEMPERATURE,
  });
}
