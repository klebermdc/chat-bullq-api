const META_TO_INTERNAL: Record<string, string> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
  IN_APPEAL: 'PENDING',
  FLAGGED: 'PAUSED',
  PAUSED: 'PAUSED',
  PENDING_DELETION: 'DISABLED',
  DELETED: 'DISABLED',
  DISABLED: 'DISABLED',
};

export function mapMetaTemplateStatus(event?: string): string {
  if (!event) return 'PENDING';
  return META_TO_INTERNAL[event.toUpperCase()] ?? 'PENDING';
}

export function normalizeRejectionReason(reason?: string | null): string | undefined {
  if (!reason) return undefined;
  const r = reason.trim();
  if (!r || r.toUpperCase() === 'NONE') return undefined;
  return r;
}
