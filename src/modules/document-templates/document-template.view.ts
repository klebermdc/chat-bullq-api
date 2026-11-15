import { DocumentTemplate, DocumentTemplateAudience } from '@prisma/client';
import { extractPlaceholders } from './placeholders.util';

export interface DocumentTemplateSummary {
  id: string;
  title: string;
  category: string;
  audience: DocumentTemplateAudience;
  isActive: boolean;
  placeholders: string[];
}

export interface DocumentTemplateDetail extends DocumentTemplateSummary {
  body: string;
}

type TemplateRow = Pick<
  DocumentTemplate,
  'id' | 'title' | 'category' | 'audience' | 'isActive' | 'body'
>;

export function toSummary(t: TemplateRow): DocumentTemplateSummary {
  return {
    id: t.id,
    title: t.title,
    category: t.category,
    audience: t.audience,
    isActive: t.isActive,
    placeholders: extractPlaceholders(t.body),
  };
}

export function toDetail(t: TemplateRow): DocumentTemplateDetail {
  return { ...toSummary(t), body: t.body };
}
