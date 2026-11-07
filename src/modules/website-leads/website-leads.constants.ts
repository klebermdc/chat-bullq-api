/** Fila BullMQ do retorno automático ao lead do site. */
export const WEBSITE_LEAD_FOLLOWUP_QUEUE = 'website-lead-followup';
export const WEBSITE_LEAD_FOLLOWUP_JOB = 'send-followup';

export const DEFAULT_DELAY_MINUTES = 5;
export const MIN_DELAY_MINUTES = 1;
export const MAX_DELAY_MINUTES = 24 * 60;

/** Nome do template criado na Meta para o retorno. */
export const DEFAULT_TEMPLATE_NAME = 'lead_site_retorno';

/** Envio igual dentro desta janela é o mesmo envio (duplo clique, reenvio). */
export const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

/** Não manda o template pago de novo ao mesmo contato dentro deste prazo. */
export const RECENT_FOLLOWUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Envio do site recente o bastante para marcar a conversa como "Site". */
export const SITE_ORIGIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Conversa com resposta humana nesse prazo = humano atendendo; não manda template. */
export const HUMAN_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const SITE_TAG = 'Site';
export const GUIAMENTO_TAG = 'Guiamento';

/** Texto do botão de recusa do template (comparado sem acento/caixa). */
export const DECLINE_BUTTON_TEXT = 'agora nao';

export const DECLINE_REPLY =
  'Sem problemas{nome}! 😊 Obrigada pelo retorno. Quando quiser planejar sua viagem para Orlando, é só mandar uma mensagem por aqui. Até breve! ✈️';

export const FOLLOWUP_SOURCE = 'website_lead_followup';

export type FollowupStatus = 'PENDING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED' | 'DECLINED';
