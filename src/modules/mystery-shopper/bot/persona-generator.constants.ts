/** Teto do campo `persona` do robô (StartBotDto): a persona gerada precisa caber nele. */
export const PERSONA_MAX_CHARS = 2000;
/** Mínimo do StartBotDto. */
export const PERSONA_MIN_CHARS = 10;
/** Acima disto a IA saiu do controle: tenta de novo em vez de cortar. */
export const PERSONA_RUNAWAY_CHARS = PERSONA_MAX_CHARS * 2;

export const PERSONA_BRIEF_MIN_CHARS = 5;
export const PERSONA_BRIEF_MAX_CHARS = 500;

/** Tetos do "conhecimento do Sendtur" levado ao prompt (por fonte). */
export const PERSONA_FAQ_MAX_CHARS = 6000;
export const PERSONA_FAQ_MAX_ROWS = 300;
export const PERSONA_AGENT_MAX_CHARS = 5000;
export const PERSONA_LOST_REASONS_MAX = 6;
export const PERSONA_LOST_WINDOW_DAYS = 90;

export const PERSONA_TEMPERATURE = 0.9;
export const PERSONA_MAX_TOKENS = 900;
export const PERSONA_MAX_ATTEMPTS = 2;
