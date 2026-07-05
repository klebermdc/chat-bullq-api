export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  plan: string;
  createdAt: Date;
}

// Allowlist: só os campos abaixo saem. settings/config de IA/token caps são
// omitidos por construção (nunca copiados).
export function mapOrganization(o: any): PublicOrganization {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? null,
    plan: o.plan,
    createdAt: o.createdAt,
  };
}
