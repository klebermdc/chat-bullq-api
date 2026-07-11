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

/**
 * Onde o card cai quando a proposta é enviada. Nome é editável pelo operador
 * na UI, então deixamos configurável por env com defaults sensatos.
 */
export const PROPOSAL_SENT_PIPELINE_NAME =
  process.env.SALES_PIPELINE_NAME?.trim() || 'Vendas OFP';
export const PROPOSAL_SENT_STAGE_NAME =
  process.env.PROPOSAL_SENT_STAGE_NAME?.trim() || 'Proposta enviada';
