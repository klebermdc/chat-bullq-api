import { DocumentTemplateAudience } from '@prisma/client';
import { MAX_BODY_LENGTH, MAX_CATEGORY_LENGTH, MAX_TITLE_LENGTH } from './dto/document-template.dto';

export const MAX_SOURCE_REF_LENGTH = 200;
/** Arquivo de importação é de uma org: dezenas de modelos, não milhares. */
export const MAX_TEMPLATES_PER_FILE = 1000;

export interface ImportTemplate {
  sourceRef: string;
  title: string;
  category: string;
  audience: DocumentTemplateAudience;
  body: string;
}

export interface ImportParseResult {
  templates: ImportTemplate[];
  /** Erros legíveis, com o índice do item — nunca com o corpo do modelo. */
  errors: string[];
}

const AUDIENCES: readonly string[] = Object.values(DocumentTemplateAudience);

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function parseItem(raw: unknown, index: number): { item?: ImportTemplate; errors: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: [`templates[${index}]: não é um objeto`] };
  }
  const r = raw as Record<string, unknown>;
  const sourceRef = text(r.sourceRef, MAX_SOURCE_REF_LENGTH);
  const title = text(r.title, MAX_TITLE_LENGTH);
  const category = text(r.category, MAX_CATEGORY_LENGTH);
  const audience = typeof r.audience === 'string' && AUDIENCES.includes(r.audience)
    ? (r.audience as DocumentTemplateAudience)
    : null;
  // Corpo sem trim: o recuo/quebras do documento são parte do texto.
  const body = typeof r.body === 'string' && r.body.trim().length > 0 && r.body.length <= MAX_BODY_LENGTH
    ? r.body
    : null;

  const errors = [
    !sourceRef && `sourceRef (texto, até ${MAX_SOURCE_REF_LENGTH})`,
    !title && `title (texto, até ${MAX_TITLE_LENGTH})`,
    !category && `category (texto, até ${MAX_CATEGORY_LENGTH})`,
    !audience && 'audience (CLIENT ou INTERNAL)',
    !body && `body (texto não vazio, até ${MAX_BODY_LENGTH})`,
  ]
    .filter((e): e is string => Boolean(e))
    .map((field) => `templates[${index}]: campo inválido — ${field}`);

  if (errors.length > 0 || !sourceRef || !title || !category || !audience || !body) {
    return { errors };
  }
  return { item: { sourceRef, title, category, audience, body }, errors: [] };
}

/** Valida `{ templates: [...] }` inteiro; sourceRef repetido é erro. */
export function parseImportFile(data: unknown): ImportParseResult {
  const list = (data as { templates?: unknown } | null)?.templates;
  if (!Array.isArray(list)) {
    return { templates: [], errors: ['o arquivo precisa ter { "templates": [...] }'] };
  }
  if (list.length > MAX_TEMPLATES_PER_FILE) {
    return { templates: [], errors: [`mais de ${MAX_TEMPLATES_PER_FILE} modelos no arquivo`] };
  }
  const parsed = list.map(parseItem);
  const templates = parsed.flatMap((p) => (p.item ? [p.item] : []));
  const seen = new Set<string>();
  const duplicates = templates
    .filter((t) => (seen.has(t.sourceRef) ? true : (seen.add(t.sourceRef), false)))
    .map((t) => `sourceRef repetido: ${JSON.stringify(t.sourceRef)}`);
  return { templates, errors: [...parsed.flatMap((p) => p.errors), ...duplicates] };
}
