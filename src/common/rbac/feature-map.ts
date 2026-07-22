import { OrgRole } from '@prisma/client';

const ALL: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT];
const STAFF: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

/**
 * A lista de funções do app e quem acessa cada uma.
 *
 * Esta é a ÚNICA fonte da verdade: alimenta o RolesGuard (bloqueio), o
 * `GET /auth/me` (o que o frontend esconde) e a legenda da tela de Membros.
 *
 * Feature que não estiver aqui é NEGADA para todo mundo — fail-closed de
 * propósito, para que uma feature nova não nasça aberta por esquecimento.
 *
 * OWNER e ADMIN são idênticos aqui; a diferença entre os dois vive só nas
 * regras de membros (OWNER não pode ser removido nem rebaixado).
 */
export const FEATURE_MAP = {
  // --- Inbox -------------------------------------------------------------
  'inbox.view': ALL, // escopado por assignedToId para AGENT
  'inbox.transfer': ALL,
  'inbox.close': ALL,
  'inbox.notes': ALL,
  'inbox.call': ALL,
  'inbox.schedule': ALL,
  'inbox.deal.win': ALL, // Marcar como Ganho / pedido enviado / proposta
  'inbox.view.unassigned': STAFF,
  'inbox.ai.toggle': STAFF,
  'inbox.bulk': STAFF,

  // --- Pipeline ----------------------------------------------------------
  'pipelines.view': ALL, // escopado por atribuição para AGENT
  'pipelines.manage': STAFF, // criar/editar/apagar funis e etapas

  // --- Contatos ----------------------------------------------------------
  'contacts.view': ALL,
  'contacts.manage': ALL,

  // --- Painéis -----------------------------------------------------------
  'dashboard.view': ALL, // escopado: AGENT só a própria linha
  'sales-reports.view': ALL, // escopado por email: só os pedidos dele
  'crm-reports.view': STAFF,

  // --- Biblioteca de arquivos -------------------------------------------
  'media.use': ALL,
  'media.delete': STAFF,

  // --- Conta do próprio usuário -----------------------------------------
  'account.self': ALL, // minha senha, meu horário, meu ramal

  // --- Só gestão ---------------------------------------------------------
  'automations.view': STAFF,
  'projects.view': STAFF,
  'inactivity.view': STAFF,
  'ai-agents.view': STAFF,
  'chatbot.view': STAFF,
  'copilot.view': STAFF,
  'products.view': STAFF,
  'settings.view': STAFF, // cobre as 19 abas de Configurações
} as const satisfies Record<string, OrgRole[]>;

// `keyof typeof FEATURE_MAP` só é uma união literal real ("inbox.view" |
// "pipelines.manage" | ...) por causa do `as const` acima. Sem ele o map
// colapsava pra `Record<string, OrgRole[]>` e `FeatureKey` virava `string` —
// aí `@Feature('pipeline.manage')` (typo, falta o "s") compilava igual, e
// `can()` fail-closed devolvia 403 pra TODO MUNDO, inclusive OWNER, sem
// nenhum teste pegando.
export type FeatureKey = keyof typeof FEATURE_MAP;

/**
 * O cargo pode usar a feature? Nega feature desconhecida e role ausente.
 *
 * Assinatura em `string`, não `FeatureKey`, de propósito: o RolesGuard lê a
 * chave de `Reflector.getAllAndOverride` (metadata do decorator), que não
 * carrega o tipo literal em runtime — só o decorator `@Feature` é tipado.
 */
export function can(role: OrgRole | undefined, feature: string): boolean {
  if (!role) return false;
  const allowed = (FEATURE_MAP as Record<string, readonly OrgRole[] | undefined>)[feature];
  if (!allowed) return false;
  return allowed.includes(role);
}

/** Todas as features liberadas para o cargo. Role ausente → lista vazia. */
export function permissionsFor(role: OrgRole | undefined): string[] {
  if (!role) return [];
  return Object.keys(FEATURE_MAP).filter((f) =>
    (FEATURE_MAP as Record<string, readonly OrgRole[]>)[f].includes(role),
  );
}
