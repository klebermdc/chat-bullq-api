/**
 * Leitura do corpo do Webhook do Elementor Pro.
 *
 * O Elementor manda dois formatos (form-urlencoded):
 *  - simples: `{ "<rótulo do campo>": valor, "Page URL": ..., "Remote IP": ... }`;
 *  - "Advanced Data": `form[id]`, `form[name]`, `fields[<id>][value]`,
 *    `meta[page_url][value]`, `meta[remote_ip][value]`...
 * O Express já aninha os colchetes; se vier achatado (chave literal
 * `fields[nome][value]`), aninhamos aqui. JSON no mesmo formato também serve.
 */

const MAX_VALUE_LENGTH = 200;
const MAX_URL_LENGTH = 2000;

/** Campos ocultos de rastreio que o site preenche pela query da página. */
export const TRACKING_FIELD_IDS = [
  'ofp_src',
  'ofp_mdm',
  'ofp_cmp',
  'ofp_cnt',
  'ofp_trm',
  'fbclid',
  'gclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
] as const;

export interface ParsedWebsiteLead {
  name: string | null;
  email: string | null;
  phoneRaw: string | null;
  formId: string | null;
  formName: string | null;
  pageUrl: string | null;
  referrer: string | null;
  userAgent: string | null;
  remoteIp: string | null;
  /** Campos ocultos de rastreio preenchidos (vazios ficam de fora). */
  hidden: Record<string, string>;
}

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clean(v: unknown, max = MAX_VALUE_LENGTH): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return clean(v[0], max);
  if (isDict(v)) return clean(v.value ?? v.raw_value, max);
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** `fields[nome][value]` → { fields: { nome: { value } } } (chaves achatadas). */
export function nestBracketKeys(body: Dict): Dict {
  const out: Dict = {};
  for (const [key, value] of Object.entries(body)) {
    const parts = key.match(/[^[\]]+/g);
    if (!parts || parts.length === 1 || !key.includes('[')) {
      out[key] = isDict(out[key]) && isDict(value) ? { ...(out[key] as Dict), ...value } : value;
      continue;
    }
    let cursor = out;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        cursor[part] = value;
        return;
      }
      if (!isDict(cursor[part])) cursor[part] = {};
      cursor = cursor[part] as Dict;
    });
  }
  return out;
}

function normalizeKey(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const PHONE_KEY = /whats|telefone|celular|phone|fone|tel\b/;
const NAME_KEY = /^(nome|name|seu nome|nome completo|first.?name)/;
const EMAIL_KEY = /e-?mail/;

interface FieldEntry {
  id: string;
  label: string;
  type: string;
  value: string | null;
}

function fieldEntries(body: Dict): FieldEntry[] {
  if (isDict(body.fields)) {
    return Object.entries(body.fields).map(([id, raw]) => {
      const f = isDict(raw) ? raw : { value: raw };
      return {
        id: normalizeKey(String(f.id ?? id)),
        label: normalizeKey(String(f.title ?? f.label ?? id)),
        type: normalizeKey(String(f.type ?? '')),
        value: clean(f.value ?? f.raw_value),
      };
    });
  }
  // Formato simples: tudo que não é meta conhecido é campo.
  return Object.entries(body)
    .filter(([k]) => !['form', 'meta', 'fields'].includes(k))
    .map(([k, v]) => ({ id: normalizeKey(k), label: normalizeKey(k), type: '', value: clean(v) }));
}

function metaValue(body: Dict, metaKey: string, simpleLabels: string[]): string | null {
  const meta = isDict(body.meta) ? body.meta : null;
  if (meta && meta[metaKey] !== undefined) return clean(meta[metaKey], MAX_URL_LENGTH);
  for (const [k, v] of Object.entries(body)) {
    if (simpleLabels.includes(normalizeKey(k))) return clean(v, MAX_URL_LENGTH);
  }
  return null;
}

function pick(entries: FieldEntry[], test: (e: FieldEntry) => boolean): string | null {
  return entries.find((e) => e.value && test(e))?.value ?? null;
}

export function parseWebsiteLeadPayload(input: unknown): ParsedWebsiteLead {
  const body = isDict(input) ? nestBracketKeys(input) : {};
  const entries = fieldEntries(body);
  const form = isDict(body.form) ? body.form : {};

  const hidden: Record<string, string> = {};
  for (const id of TRACKING_FIELD_IDS) {
    const v = pick(entries, (e) => e.id === id || e.label === id);
    if (v) hidden[id] = v;
  }

  return {
    name: pick(entries, (e) => e.id === 'nome' || e.id === 'name' || NAME_KEY.test(e.label)),
    email: pick(entries, (e) => e.type === 'email' || EMAIL_KEY.test(e.id) || EMAIL_KEY.test(e.label)),
    phoneRaw: pick(
      entries,
      (e) => e.type === 'tel' || e.type === 'telephone' || PHONE_KEY.test(e.id) || PHONE_KEY.test(e.label),
    ),
    formId: clean(form.id),
    formName: clean(form.name),
    pageUrl: metaValue(body, 'page_url', ['page url', 'url da pagina', 'current_url']),
    referrer: metaValue(body, 'referrer', ['referrer', 'referer']),
    userAgent: metaValue(body, 'user_agent', ['user agent']),
    remoteIp: metaValue(body, 'remote_ip', ['remote ip', 'ip remoto']),
    hidden,
  };
}
