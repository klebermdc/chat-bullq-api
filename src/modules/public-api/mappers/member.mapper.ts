export interface PublicMember {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  agentStatus: string;
  joinedAt: Date;
}

export function mapMember(m: any): PublicMember {
  return {
    id: m.id,
    userId: m.userId ?? m.user?.id,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
    avatarUrl: m.user?.avatarUrl ?? null,
    role: m.role,
    agentStatus: m.agentStatus,
    joinedAt: m.joinedAt,
  };
}
