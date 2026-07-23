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
