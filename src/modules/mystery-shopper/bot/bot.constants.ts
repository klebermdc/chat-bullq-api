/** Mensagem fixa com que o robô abre a conversa (cliente que viu o anúncio). */
export const BOT_OPENING_MESSAGE = 'Olá! Vi esse anúncio e quero solicitar uma cotação.';

export const BOT_TURN_JOB = 'bot-turn';

/** Espera de leitura antes de o robô responder (recomeça a cada mensagem nova da equipe). */
export const BOT_READ_DELAY_MIN_MS = 40_000;
export const BOT_READ_DELAY_MAX_MS = 90_000;

/** Depois disto o robô é forçado a encerrar no próximo turno. */
export const BOT_MAX_CLIENT_MESSAGES = 15;
export const BOT_HISTORY_LIMIT = 60;
export const BOT_MAX_TOKENS = 600;
export const BOT_TEMPERATURE = 0.7;
export const BOT_MAX_ATTEMPTS = 2;
export const BOT_MAX_REPLY_CHARS = 1000;

/** Janela em que o cliente "responde": fora dela o turno é adiado para a manhã. */
export const BOT_WINDOW_START_MINUTES = 8 * 60;
export const BOT_WINDOW_END_MINUTES = 22 * 60 + 30;
export const BOT_MORNING_JITTER_MS = 30 * 60_000;
export const BOT_DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Um jobId por execução: é a chave do debounce. Sem ":" — o BullMQ recusa. */
export function botTurnJobId(runId: string): string {
  return `bot-turn-${runId}`;
}
