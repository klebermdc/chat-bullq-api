import { describe, expect, test } from 'vitest';
import { LatencyTracker } from './latency.js';
import { loadConfig } from './config.js';

describe('LatencyTracker', () => {
  test('mede do fim da fala do cliente até a Aline começar a falar', () => {
    const t = new LatencyTracker();
    t.onUserState('listening', 'speaking', 1000);
    t.onUserState('speaking', 'listening', 3000);
    expect(t.onAgentState('thinking', 3500)).toBeNull();
    expect(t.onAgentState('speaking', 4800)).toEqual({ turno: 1, ms: 1800 });
  });

  test('saudação inicial (sem fala do cliente) não conta como turno', () => {
    const t = new LatencyTracker();
    expect(t.onAgentState('speaking', 500)).toBeNull();
    expect(t.summary()).toBeNull();
  });

  test('cliente voltou a falar antes da resposta: zera a medição', () => {
    const t = new LatencyTracker();
    t.onUserState('speaking', 'listening', 1000);
    t.onUserState('listening', 'speaking', 1200);
    expect(t.onAgentState('speaking', 2000)).toBeNull();
  });

  test('resumo com mediana e p90', () => {
    const t = new LatencyTracker();
    [1000, 2000, 3000, 4000, 5000].forEach((ms, i) => {
      const base = i * 10_000;
      t.onUserState('speaking', 'listening', base);
      t.onAgentState('speaking', base + ms);
    });
    expect(t.summary()).toEqual({ turnos: 5, medianaMs: 3000, p90Ms: 5000 });
  });
});

describe('loadConfig', () => {
  const base = {
    LIVEKIT_URL: 'wss://livekit.example.com',
    LIVEKIT_API_KEY: 'k',
    LIVEKIT_API_SECRET: 's',
    STT_BASE_URL: 'http://speaches:8000/v1',
    STT_API_KEY: 'x',
    TTS_BASE_URL: 'http://speaches:8000/v1',
    TTS_API_KEY: 'x',
    LLM_BASE_URL: 'https://api.minimax.io/v1',
    LLM_API_KEY: 'x',
    LLM_MODEL: 'MiniMax-M2',
  };

  test('aplica os padrões de STT/TTS e voz', () => {
    const cfg = loadConfig(base);
    expect(cfg.STT_MODEL).toBe('Systran/faster-whisper-small');
    expect(cfg.TTS_VOICE).toBe('pf_dora');
    expect(cfg.AGENT_NAME).toBe('aline-voz');
    expect(cfg.VAD_MIN_SILENCE_MS).toBe(400);
  });

  test('recusa silêncio do VAD abaixo de 250 ms (unidade é ms, não segundos)', () => {
    expect(() => loadConfig({ ...base, VAD_MIN_SILENCE_MS: '0.4' })).toThrow(/VAD_MIN_SILENCE_MS/);
  });

  test('TTS_EXTRA_BODY vira objeto; JSON inválido dá erro claro', () => {
    expect(loadConfig({ ...base, TTS_EXTRA_BODY: '{"lang_code":"portuguese"}' }).TTS_EXTRA_BODY).toEqual({ lang_code: 'portuguese' });
    expect(loadConfig(base).TTS_EXTRA_BODY).toEqual({});
    expect(() => loadConfig({ ...base, TTS_EXTRA_BODY: '[1]' })).toThrow(/TTS_EXTRA_BODY/);
  });

  test('provedor anthropic exige ANTHROPIC_API_KEY e dispensa LLM_BASE_URL', () => {
    const { LLM_BASE_URL: _u, LLM_API_KEY: _k, ...semOpenai } = base;
    expect(() => loadConfig({ ...semOpenai, LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    const cfg = loadConfig({ ...semOpenai, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x', LLM_EXTRA_BODY: '{"output_config":{"effort":"low"}}' });
    expect(cfg.LLM_EXTRA_BODY).toEqual({ output_config: { effort: 'low' } });
  });

  test('erro claro quando falta variável', () => {
    const { LLM_API_KEY: _omit, ...semChave } = base;
    expect(() => loadConfig(semChave)).toThrow(/LLM_API_KEY/);
  });
});
