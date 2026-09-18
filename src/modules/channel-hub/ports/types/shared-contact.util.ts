/**
 * Cartão de contato que o cliente compartilha no WhatsApp ("Enviar contato").
 * Cada provedor manda num formato (Meta: objeto `contacts[]`; Baileys/Zappfy:
 * vCard em texto) — aqui vira um formato só, gravado em `content.contacts`.
 */
export interface SharedContact {
  name: string;
  phones: Array<{ phone: string; waId?: string; type?: string }>;
  emails?: string[];
  org?: string;
}

const MIN_WAID_DIGITS = 8;

function unescapeVcard(value: string): string {
  return value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim();
}

/** Lê FN, TEL (preferindo o `waid=`) e EMAIL de um vCard 2.1/3.0/4.0. */
export function parseVcard(vcard: string, fallbackName = ''): SharedContact {
  // Linhas dobradas (continuação começa com espaço) viram uma só.
  const lines = (vcard || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let name = '';
  const phones: SharedContact['phones'] = [];
  const emails: string[] = [];

  for (const line of lines) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const head = line.slice(0, sep);
    const value = unescapeVcard(line.slice(sep + 1));
    // `item1.TEL;waid=...` → propriedade TEL, parâmetros depois do `;`.
    const [prop, ...params] = head.split(';');
    const key = prop.split('.').pop()!.toUpperCase();

    if (key === 'FN' && value) name = value;
    if (key === 'EMAIL' && value) emails.push(value);
    if (key === 'TEL' && value) {
      const waParam = params.find((p) => p.toLowerCase().startsWith('waid='));
      const waDigits = waParam ? waParam.slice(5).replace(/\D/g, '') : value.replace(/\D/g, '');
      phones.push(waDigits.length >= MIN_WAID_DIGITS ? { phone: value, waId: waDigits } : { phone: value });
    }
  }

  const out: SharedContact = { name: name || fallbackName || phones[0]?.phone || 'Contato', phones };
  if (emails.length) out.emails = emails;
  return out;
}

/** Formato `contacts[]` do webhook da WhatsApp Cloud API. */
export function contactsFromMeta(raw: unknown): SharedContact[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any) => {
    const phones = (c?.phones ?? []).map((p: any) => {
      const phone: SharedContact['phones'][number] = { phone: p?.phone ?? p?.wa_id ?? '' };
      if (p?.wa_id) phone.waId = String(p.wa_id);
      if (p?.type) phone.type = p.type;
      return phone;
    });
    const fullName = [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ');
    const out: SharedContact = {
      name: c?.name?.formatted_name || fullName || phones[0]?.phone || 'Contato',
      phones,
    };
    const emails = (c?.emails ?? []).map((e: any) => e?.email).filter(Boolean);
    if (emails.length) out.emails = emails;
    if (c?.org?.company) out.org = c.org.company;
    return out;
  });
}

/**
 * Texto curto da mensagem. Vai em `content.text` para a prévia da lista, a
 * busca, a IA e o "Responder" continuarem funcionando sem saber de contatos.
 */
export function contactsSummary(contacts: SharedContact[]): string {
  if (contacts.length === 1) return `👤 ${contacts[0].name}`;
  return `👤 ${contacts.length} contatos`;
}
