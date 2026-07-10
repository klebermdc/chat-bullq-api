export const PROPOSAL_RENDER_DELAY_MS = Number(
  process.env.PROPOSAL_RENDER_DELAY_MS ?? 1000,
);
export const PROPOSAL_RENDER_TIMEOUT_MS = Number(
  process.env.PROPOSAL_RENDER_TIMEOUT_MS ?? 20000,
);
export const PROPOSAL_ALLOWED_HOSTS = (
  process.env.PROPOSAL_ALLOWED_HOSTS ?? 'reservas.orlandofastpass.com.br'
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
