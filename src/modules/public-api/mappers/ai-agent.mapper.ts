export interface PublicAiAgent {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  kind: string;
  category: string | null;
  department: string | null;
  squad: string | null;
  parentAgentId: string | null;
  capabilities: string[];
  isActive: boolean;
  canRespondDirectly: boolean;
  modelId: string;
  createdAt: Date;
  channels: { id: string; name: string; type: string }[];
}

// Allowlist: só os campos abaixo saem. systemPrompt/operationalContext/modelParams/
// temperature/maxTokens/followUpCadenceHours são omitidos por construção (PI + tuning).
export function mapAiAgent(a: any): PublicAiAgent {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    avatarUrl: a.avatarUrl ?? null,
    kind: a.kind,
    category: a.category ?? null,
    department: a.department ?? null,
    squad: a.squad ?? null,
    parentAgentId: a.parentAgentId ?? null,
    capabilities: a.capabilities ?? [],
    isActive: a.isActive,
    canRespondDirectly: a.canRespondDirectly,
    modelId: a.modelId,
    createdAt: a.createdAt,
    channels: (a.channels ?? []).map((c: any) => ({ id: c.channel?.id, name: c.channel?.name, type: c.channel?.type })),
  };
}
