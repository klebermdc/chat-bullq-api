export const PROPOSAL_RENDER_DELAY_MS = Number(
  process.env.PROPOSAL_RENDER_DELAY_MS ?? 1000,
);
export const PROPOSAL_RENDER_TIMEOUT_MS = Number(
  process.env.PROPOSAL_RENDER_TIMEOUT_MS ?? 20000,
);
// Nome da etapa do pipeline pra onde o card vai quando uma proposta é enviada.
export const PROPOSAL_SENT_STAGE_NAME =
  process.env.PROPOSAL_SENT_STAGE_NAME ?? 'PROPOSTA ENVIADA';

export const PROPOSAL_ALLOWED_HOSTS = (
  process.env.PROPOSAL_ALLOWED_HOSTS ?? 'reservas.orlandofastpass.com.br'
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// Prints anexados à proposta. O teto de quantidade é o fan-out de leituras no
// storage dentro do mesmo request, e cada print vira uma imagem na chamada de
// visão e uma mensagem no WhatsApp.
export const PROPOSAL_MAX_IMAGES = 4;
export const PROPOSAL_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
// O upload genérico aceita até 64 MB (vídeo). Um print vai inteiro para a
// memória e, em base64, para o provedor de LLM — o teto é conferido pelo
// tamanho no storage ANTES de carregar o arquivo.
export const PROPOSAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Extração da proposta "outros" (não-ingresso): limites do que vai ao cliente.
export const PROPOSAL_OTHER_TITLE_MAX = 120;
export const PROPOSAL_OTHER_MAX_LINES = 12;
export const PROPOSAL_OTHER_LINE_MAX = 160;
