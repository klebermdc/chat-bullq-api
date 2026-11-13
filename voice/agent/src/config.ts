import { z } from 'zod';

/**
 * Configuração do agente de voz. Tudo vem do ambiente; nada de segredo no código.
 * STT, TTS e LLM são "compatíveis com OpenAI": trocar de motor ou provedor é
 * mudar BASE_URL + MODEL (ex.: Speaches → Qwen3-TTS numa GPU).
 */
const jsonObject = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw || !raw.trim()) return {} as Record<string, unknown>;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* cai no erro abaixo */
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'precisa ser um objeto JSON' });
    return z.NEVER;
  });

const schema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  AGENT_NAME: z.string().min(1).default('aline-voz'),

  STT_BASE_URL: z.string().url(),
  STT_API_KEY: z.string().min(1),
  STT_MODEL: z.string().min(1).default('Systran/faster-whisper-small'),
  STT_LANGUAGE: z.string().min(2).default('pt'),

  TTS_BASE_URL: z.string().url(),
  TTS_API_KEY: z.string().min(1),
  TTS_MODEL: z.string().min(1).default('speaches-ai/Kokoro-82M-v1.0-ONNX'),
  TTS_VOICE: z.string().min(1).default('pf_dora'),
  TTS_SPEED: z.coerce.number().min(0.5).max(2).default(1),
  /** Campos extras no JSON do pedido de voz (ex.: {"lang_code":"portuguese","stream":true}). */
  TTS_EXTRA_BODY: jsonObject,

  /** openai = qualquer API compatível com OpenAI (MiniMax hoje); anthropic = Claude pelo SDK oficial. */
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1),
  /** Só para o provedor openai: os modelos Claude atuais recusam temperature. */
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.4),
  /** Campos extras no JSON do pedido ao LLM (ex.: {"output_config":{"effort":"low"}} no Claude). */
  LLM_EXTRA_BODY: jsonObject,

  /** API do Sendtur para as ferramentas da ligação (agenda). Sem os dois, a Aline não marca no sistema. */
  SENDTUR_API_URL: z.string().url().optional(),
  VOICE_SERVICE_SECRET: z.string().min(16).optional(),

  /** Silêncio (ms) que o VAD espera para considerar que a pessoa parou de falar (mín. 250). */
  VAD_MIN_SILENCE_MS: z.coerce.number().int().min(250).max(2000).default(400),
  /** Espera mínima (ms) antes de responder depois do fim da fala (padrão do LiveKit: 500). */
  ENDPOINTING_MIN_DELAY_MS: z.coerce.number().int().min(0).max(3000).default(300),
});

const checked = schema.superRefine((cfg, ctx) => {
  if (cfg.LLM_PROVIDER === 'openai') {
    if (!cfg.LLM_BASE_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['LLM_BASE_URL'], message: 'obrigatório com LLM_PROVIDER=openai' });
    if (!cfg.LLM_API_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['LLM_API_KEY'], message: 'obrigatório com LLM_PROVIDER=openai' });
  }
  if (cfg.LLM_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ANTHROPIC_API_KEY'], message: 'obrigatório com LLM_PROVIDER=anthropic' });
  }
});

export type VoiceConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const parsed = checked.safeParse(env);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida do agente de voz:\n- ${campos.join('\n- ')}`);
  }
  return parsed.data;
}
