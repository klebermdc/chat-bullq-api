import { DocumentTemplate, DocumentTemplateAudience, OrgRole } from '@prisma/client';

/** Quem gerencia modelos e vê os internos/inativos. */
export function isTemplateManager(role: OrgRole | undefined): boolean {
  return role === OrgRole.OWNER || role === OrgRole.ADMIN;
}

/**
 * AGENT só enxerga modelo de CLIENTE ativo. OWNER/ADMIN enxergam tudo da org.
 * (A org já foi filtrada na consulta; aqui é só a regra de papel.)
 */
export function canSeeTemplate(
  role: OrgRole | undefined,
  template: Pick<DocumentTemplate, 'audience' | 'isActive'>,
): boolean {
  if (isTemplateManager(role)) return true;
  return template.audience === DocumentTemplateAudience.CLIENT && template.isActive;
}
