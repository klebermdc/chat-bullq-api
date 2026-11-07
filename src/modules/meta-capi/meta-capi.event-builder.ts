import { createHash } from 'crypto';
import { hashPhoneSha256 } from '../../common/utils/phone-hash.util';
import { CTWA_ATTRIBUTION_WINDOW_DAYS, FBC_MAX_AGE_DAYS } from './meta-capi.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurchaseInput {
  eventId: string;
  eventTime: number;
  value: number;
  currency: string;
  now: Date;
  contact: {
    phone: string | null;
    email: string | null;
    ctwaClid: string | null;
    ctwaClidAt: Date | null;
  } | null;
  /** WABA do canal da conversa do card (lead de WhatsApp). */
  wabaId: string | null;
  /** Página do Facebook (config da CAPI) — exigida no caminho por hash. */
  pageId: string | null;
  /** Último envio do formulário do site antes da venda, se houver. */
  siteLead: {
    submittedAt: Date;
    fbclid: string | null;
    pageUrl: string | null;
    ip: string | null;
    userAgent: string | null;
  } | null;
}

export type PurchaseBuild =
  | { ok: true; path: 'ctwa' | 'site' | 'whatsapp_hash'; event: Record<string, unknown> }
  | { ok: false; reason: string };

export function hashEmailSha256(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  if (!e || !e.includes('@')) return null;
  return createHash('sha256').update(e).digest('hex');
}

/** `fb.1.<criação em ms>.<fbclid>` — formato do cookie _fbc da Meta. */
export function buildFbc(fbclid: string, createdAt: Date): string {
  return `fb.1.${createdAt.getTime()}.${fbclid}`;
}

function withinDays(at: Date | null, now: Date, days: number): boolean {
  return !!at && now.getTime() - at.getTime() <= days * DAY_MS;
}

/**
 * Monta o Purchase da venda ganha escolhendo o caminho de atribuição, do mais
 * forte para o mais fraco (doc "Conversions API for Business Messaging"):
 *
 *  1. clique em anúncio CTWA recente → business_messaging + WABA + ctwa_clid;
 *  2. lead do site com fbclid → website + fbc (+ e-mail/telefone com hash);
 *  3. lead de WhatsApp sem clique → business_messaging por hash, que a Meta só
 *     aceita com `page_id` + WABA;
 *  4. lead do site sem fbclid → website só com hash e IP/navegador.
 *
 * O `event_id` é o mesmo em toda tentativa: a Meta deduplica.
 */
export function buildPurchaseEvent(input: PurchaseInput): PurchaseBuild {
  const ph = hashPhoneSha256(input.contact?.phone);
  const em = hashEmailSha256(input.contact?.email);
  const hashes = { ...(ph ? { ph: [ph] } : {}), ...(em ? { em: [em] } : {}) };
  const base = {
    event_name: 'Purchase',
    event_time: input.eventTime,
    event_id: input.eventId,
    custom_data: { value: input.value, currency: input.currency },
  };
  const messaging = { action_source: 'business_messaging', messaging_channel: 'whatsapp' };

  const c = input.contact;
  if (c?.ctwaClid && input.wabaId && withinDays(c.ctwaClidAt, input.now, CTWA_ATTRIBUTION_WINDOW_DAYS)) {
    return {
      ok: true,
      path: 'ctwa',
      event: {
        ...base,
        ...messaging,
        user_data: { whatsapp_business_account_id: input.wabaId, ctwa_clid: c.ctwaClid },
      },
    };
  }

  const site = input.siteLead;
  const siteEvent = (withFbc: boolean) => ({
    ...base,
    action_source: 'website',
    ...(site?.pageUrl ? { event_source_url: site.pageUrl } : {}),
    user_data: {
      ...hashes,
      ...(withFbc && site?.fbclid ? { fbc: buildFbc(site.fbclid, site.submittedAt) } : {}),
      ...(site?.ip ? { client_ip_address: site.ip } : {}),
      ...(site?.userAgent ? { client_user_agent: site.userAgent } : {}),
    },
  });

  if (site?.fbclid && withinDays(site.submittedAt, input.now, FBC_MAX_AGE_DAYS)) {
    return { ok: true, path: 'site', event: siteEvent(true) };
  }

  if (input.wabaId && input.pageId && (ph || em)) {
    return {
      ok: true,
      path: 'whatsapp_hash',
      event: {
        ...base,
        ...messaging,
        user_data: { page_id: input.pageId, whatsapp_business_account_id: input.wabaId, ...hashes },
      },
    };
  }

  if (site && (ph || em)) return { ok: true, path: 'site', event: siteEvent(false) };

  if (!ph && !em) return { ok: false, reason: 'no_match_data' };
  return { ok: false, reason: input.pageId ? 'no_waba' : 'no_page_id' };
}
