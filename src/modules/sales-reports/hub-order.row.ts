/**
 * Pedido que o OFP Hub empurra (POST /public/orders/won) → linha de
 * `OfpSalesOrder` no MESMO formato do sync periódico (`OfpSyncService.toRow`):
 * `externalId` = id da linha no Hub, `data` à meia-noite local e `dataRaw` em
 * "dd/mm/aaaa". Assim o próximo pull só reescreve a mesma linha, sem duplicar.
 */

export interface HubOrderInput {
  externalId: string;
  pedido: string | null;
  cliente: string | null;
  email: string | null;
  telefone: string | null;
  venda: number | null;
  /** "aaaa-mm-dd" */
  data: string;
  vendedor: string | null;
  fornecedor: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-18" → data local + "18/11/2026". Null se a data não existe (31/02). */
export function parseHubDate(raw: string): { data: Date; dataRaw: string } | null {
  const m = ISO_DATE.exec((raw ?? '').trim());
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  const data = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const valid =
    data.getFullYear() === Number(yyyy) && data.getMonth() === Number(mm) - 1 && data.getDate() === Number(dd);
  return valid ? { data, dataRaw: `${dd}/${mm}/${yyyy}` } : null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/** Campos que o Hub manda; o resto (comissões, status…) fica pro sync periódico. */
export function hubOrderToRow(input: HubOrderInput, parsed: { data: Date; dataRaw: string }) {
  return {
    pedido: clean(input.pedido),
    cliente: clean(input.cliente),
    emailCliente: clean(input.email),
    telefoneCliente: clean(input.telefone),
    vendedor: clean(input.vendedor),
    fornecedor: clean(input.fornecedor),
    venda: input.venda ?? null,
    data: parsed.data,
    dataRaw: parsed.dataRaw,
    syncedAt: new Date(),
  };
}
