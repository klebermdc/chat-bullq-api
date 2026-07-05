export interface PublicActivityLog {
  id: string;
  conversationId: string;
  actorId: string | null;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

export function mapActivityLog(l: any): PublicActivityLog {
  return {
    id: l.id,
    conversationId: l.conversationId,
    actorId: l.actorId ?? null,
    action: l.action,
    fromValue: l.fromValue ?? null,
    toValue: l.toValue ?? null,
    createdAt: l.createdAt,
  };
}
