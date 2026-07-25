/**
 * "Parado na IA" (fase Aline): a conversa ainda está sob a IA, sem humano.
 * Usado pelos motores de reengajamento (Inatividade + Cadência NO_REPLY) para
 * não reengajar leads que já foram para um atendente humano.
 *
 * aiEnabled é tri-state: null = segue org (conta como ativa), true = forçada ON,
 * false = desligada manualmente na conversa (única que exclui).
 */
export function isAiParked(c: {
  assignedToId: string | null;
  awaitingHumanReply: boolean;
  aiEnabled: boolean | null;
}): boolean {
  return !c.assignedToId && !c.awaitingHumanReply && c.aiEnabled !== false;
}
