/**
 * Atribuição do lead do site: UTMs vêm da URL da página do envio (o site não
 * tem campo oculto para as utm), e os campos ocultos ofp, fbclid e gclid vêm do
 * próprio formulário. Campo oculto vence a URL quando os dois existem.
 */

export type WebsiteFormKind = 'main' | 'guiamento';

/** Formulário de guiamento no Elementor (post 2348). */
const GUIAMENTO_FORM_ID = '0883206';

const URL_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'fbclid',
  'gclid',
] as const;

export interface WebsiteLeadAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_id?: string;
  ofp_src?: string;
  ofp_mdm?: string;
  ofp_cmp?: string;
  ofp_cnt?: string;
  ofp_trm?: string;
  fbclid?: string;
  gclid?: string;
  page_url?: string;
  referrer?: string;
  form_id?: string;
  form_name?: string;
  form_kind?: WebsiteFormKind;
  submitted_at: string;
  ip?: string;
  user_agent?: string;
}

export interface AttributionInput {
  pageUrl: string | null;
  referrer: string | null;
  hidden: Record<string, string>;
  formId: string | null;
  formName: string | null;
  userAgent?: string | null;
  remoteIp?: string | null;
}

function queryOf(url: string | null): URLSearchParams | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}

export function buildAttribution(input: AttributionInput, now: Date): WebsiteLeadAttribution {
  const out: WebsiteLeadAttribution = { submitted_at: now.toISOString() };
  const sources = [queryOf(input.pageUrl), queryOf(input.referrer)];
  for (const key of URL_PARAMS) {
    for (const q of sources) {
      const v = q?.get(key)?.trim();
      if (v) {
        out[key] = v.slice(0, 200);
        break;
      }
    }
  }
  Object.assign(out, input.hidden);
  if (input.pageUrl) out.page_url = input.pageUrl;
  if (input.referrer) out.referrer = input.referrer;
  if (input.formId) out.form_id = input.formId;
  if (input.formName) out.form_name = input.formName;
  if (input.remoteIp) out.ip = input.remoteIp;
  if (input.userAgent) out.user_agent = input.userAgent;
  return out;
}

export function classifyForm(
  input: { formId: string | null; formName: string | null; pageUrl: string | null },
  override?: string | null,
): WebsiteFormKind {
  if (override === 'guiamento' || override === 'main') return override;
  if (input.formId === GUIAMENTO_FORM_ID) return 'guiamento';
  if ((input.formName ?? '').toLowerCase().includes('guiamento')) return 'guiamento';
  try {
    if (input.pageUrl && new URL(input.pageUrl).pathname.includes('guiamento')) return 'guiamento';
  } catch {
    // URL ruim: fica no principal.
  }
  return 'main';
}
