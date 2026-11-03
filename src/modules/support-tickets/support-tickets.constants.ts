/**
 * Quadro "Suporte": chamados de qualquer cliente que relata um problema. Criado
 * sozinho no primeiro chamado da organização.
 *
 * Todas as etapas são NORMAL de propósito: "Resolvido" como WON contaria como
 * venda nos relatórios. Chamado aberto = card em etapa fora de
 * CLOSED_SUPPORT_STAGE_KEYS.
 */
export const SUPPORT_PIPELINE_KEY = 'support';

export const OPEN_SUPPORT_STAGE_KEY = 'open';
export const CLOSED_SUPPORT_STAGE_KEYS: readonly string[] = ['resolved', 'cancelled'];

// Só as cores que o kanban do web conhece (kanban-column.tsx).
export const SUPPORT_STAGES: ReadonlyArray<{ key: string; name: string; color: string }> = [
  { key: OPEN_SUPPORT_STAGE_KEY, name: 'Aberto', color: 'amber' },
  { key: 'in_progress', name: 'Em atendimento', color: 'blue' },
  { key: 'waiting_customer', name: 'Aguardando cliente', color: 'violet' },
  { key: 'resolved', name: 'Resolvido', color: 'green' },
  { key: 'cancelled', name: 'Cancelado', color: 'zinc' },
];

export const SUPPORT_CATEGORIES = {
  ingresso: 'Ingresso',
  transfer: 'Transfer',
  hotel: 'Hotel',
  voo: 'Voo',
  documento_imigracao: 'Documento',
  saude_seguranca: 'Saúde/segurança',
  pagamento: 'Pagamento',
  reembolso_troca: 'Reembolso/troca',
  outro: 'Outro',
} as const;
export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;

/** Da mais para a menos grave. */
export const SUPPORT_PRIORITIES = ['urgente', 'alta', 'normal'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export type SupportTicketSource = 'aline' | 'emergency';

export function isSupportCategory(value: string): value is SupportCategory {
  return Object.prototype.hasOwnProperty.call(SUPPORT_CATEGORIES, value);
}

export function isSupportPriority(value: string): value is SupportPriority {
  return (SUPPORT_PRIORITIES as readonly string[]).includes(value);
}

/** A mais grave das duas. */
export function higherPriority(a: SupportPriority, b: SupportPriority): SupportPriority {
  return SUPPORT_PRIORITIES.indexOf(a) <= SUPPORT_PRIORITIES.indexOf(b) ? a : b;
}

export function formatTicketNumber(n: number): string {
  return `#S-${String(n).padStart(4, '0')}`;
}
