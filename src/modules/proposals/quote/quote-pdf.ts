import { Injectable } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import { escapeHtml as esc, HtmlPdfRenderer, PDF_CSP_META } from '../../contracts/pdf/html-pdf-renderer';
import { spDateTime } from '../../contracts/pdf/contract-pdf.service';
import { QUOTE_LOGO_WHITE_PNG_BASE64 } from './quote-logo';
import type { PublicQuoteView, QuoteData, QuoteItem, QuoteTerms } from './quote.types';

const NIGHT = '#17133F';
const MUTED = '#514C78';
const LINE = '#E2DEF5';
const GROUND = '#F5F2FF';
const GOLD = '#FFC23D';
const ACCENTS = ['#12A4B0', '#6B4EFF'] as const; // teal / violeta, alternados por item
const SANS = `Helvetica,Arial,sans-serif`;
const BR_DDI = '55';
const BR_LOCAL_DIGITS = [12, 13];

const QUOTE_CSS = `
  @page{size:A4;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff}
  body{font-family:${SANS};font-size:11px;color:${NIGHT};-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .band{background:${NIGHT};color:#fff;padding:12mm 16mm 9mm}
  .band img{height:15mm}
  .band h1{font-size:26px;margin:6mm 0 1mm}
  .band .who{color:#D9D4FF;font-size:13px}
  .meta{display:flex;gap:9mm;margin-top:5mm;font-size:10px;color:#D9D4FF}
  .meta b{display:block;color:#fff;font-size:12px}
  main{padding:7mm 16mm 0}
  .summary{background:${GROUND};border-radius:8px;padding:4mm 5mm;font-size:12px;margin-bottom:5mm}
  h2{font-size:14px;margin:6mm 0 3mm;break-after:avoid;page-break-after:avoid}
  .item{border:1px solid ${LINE};border-left:5px solid;border-radius:6px;padding:3.5mm 4.5mm;margin-bottom:3mm;break-inside:avoid;page-break-inside:avoid}
  .item .prov{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.6px}
  .item h3{font-size:13px;margin:1mm 0 1.5mm;overflow-wrap:anywhere}
  .row{display:flex;justify-content:space-between;gap:4mm;color:${MUTED};margin-top:1mm}
  .row b{color:${NIGHT}}
  .desc{color:${MUTED};margin-top:1.5mm;white-space:pre-wrap;overflow-wrap:anywhere}
  .totals{background:${NIGHT};color:#fff;border-radius:8px;padding:5mm;margin-top:5mm;break-inside:avoid;page-break-inside:avoid}
  .totals .big{font-size:22px;font-weight:bold;color:${GOLD}}
  .totals div{margin-top:1mm}
  .fx{margin-top:2mm;color:#D9D4FF;font-size:10px;line-height:1.45}
  .notes{border:1px dashed ${LINE};border-radius:6px;padding:3mm 4mm;margin-top:4mm;white-space:pre-wrap;overflow-wrap:anywhere}
  .close{border:2px solid ${GOLD};border-radius:8px;padding:4mm 5mm;margin-top:5mm;break-inside:avoid;page-break-inside:avoid}
  .close a{color:${NIGHT};word-break:break-all}
  .policy{margin-top:7mm;font-size:9.5px;color:${MUTED};line-height:1.5}
  .policy h2{color:${NIGHT}}
  .policy p{margin:0 0 2mm}
  .policy ul{margin:0 0 2mm;padding-left:5mm}
  .policy li{margin-bottom:1mm}
  footer{margin:8mm 16mm 10mm;padding-top:4mm;border-top:1px solid ${LINE};color:${MUTED};font-size:9.5px;line-height:1.5;break-inside:avoid;page-break-inside:avoid}
  footer b{color:${NIGHT}}
`;

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

/** "2026-12-10" → "10/12/2026" (sem fuso: é data de calendário). */
const brDate = (iso: string) => iso.split('-').reverse().join('/');

function dateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  return end && end !== start ? `${brDate(start)} a ${brDate(end)}` : brDate(start);
}

/** "551151984190" → "+55 11 5198-4190"; fora do Brasil, só "+dígitos". */
export function formatPhone(digits: string): string {
  if (!digits.startsWith(BR_DDI) || !BR_LOCAL_DIGITS.includes(digits.length)) return `+${digits}`;
  const ddd = digits.slice(2, 4);
  const local = digits.slice(4);
  return `+${BR_DDI} ${ddd} ${local.slice(0, -4)}-${local.slice(-4)}`;
}

const byDate = (a: QuoteItem, b: QuoteItem) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999');

function people(item: QuoteItem): string {
  const parts = [
    item.adults ? `${item.adults} ${item.adults === 1 ? 'adulto' : 'adultos'}` : '',
    item.children ? `${item.children} ${item.children === 1 ? 'criança' : 'crianças'}` : '',
  ];
  return parts.filter(Boolean).join(' e ');
}

function itemBlock(item: QuoteItem, index: number, currency: string): string {
  const accent = ACCENTS[index % ACCENTS.length];
  const when = dateRange(item.startDate, item.endDate);
  return `<section class="item" style="border-left-color:${accent}">
    <div class="prov" style="color:${accent}">${esc(item.provider)}</div>
    <h3>${esc(item.title)}</h3>
    <div class="row"><span>${esc([when, people(item)].filter(Boolean).join(' · '))}</span><b>${esc(formatMoney(item.total, currency))}</b></div>
    ${item.description ? `<div class="desc">${esc(item.description)}</div>` : ''}
  </section>`;
}

function summary(quote: QuoteData): string {
  const dates = quote.items.flatMap((i) => [i.startDate, i.endDate]).filter((d): d is string => !!d).sort();
  const span = dates.length ? dateRange(dates[0], dates[dates.length - 1]) : '';
  const count = `${quote.items.length} ${quote.items.length === 1 ? 'item' : 'itens'}`;
  return `<div class="summary"><b>Resumo:</b> ${esc([count, span].filter(Boolean).join(' · '))}</div>`;
}

function totalsBlock(quote: QuoteData, terms: QuoteTerms): string {
  const { currency, installments } = quote;
  return `<section class="totals">
    <div>Total da reserva</div>
    <div class="big">${esc(formatMoney(quote.total, currency))}</div>
    ${quote.pixTotal != null ? `<div>${esc(formatMoney(quote.pixTotal, currency))} no Pix, à vista</div>` : ''}
    ${installments ? `<div>ou ${installments.count}x de ${esc(formatMoney(installments.value, currency))}</div>` : ''}
    <div class="fx">${esc(terms.exchangeNotice)}</div>
  </section>
  ${quote.notes ? `<div class="notes"><b>Observação:</b> ${esc(quote.notes)}</div>` : ''}`;
}

function closeBlock(view: PublicQuoteView, quoteUrl: string | null): string {
  const { seller, company } = view;
  return `<section class="close">
    <h2 style="margin-top:0">Para fechar</h2>
    <div>Fale com <b>${esc(seller.name)}</b>${seller.whatsapp ? ` no WhatsApp ${esc(formatPhone(seller.whatsapp))}` : ''}.</div>
    <div>Atendimento: ${esc(company.hours)}</div>
    ${quoteUrl ? `<div style="margin-top:2mm">Cotação online: <a>${esc(quoteUrl)}</a></div>` : ''}
  </section>`;
}

/** A política geral, igual para toda cotação. */
function policyBlock(terms: QuoteTerms): string {
  const { cancellation } = terms;
  const blocks = cancellation.blocks
    .map((b) => (b.kind === 'p' ? `<p>${esc(b.text)}</p>` : `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`))
    .join('');
  return `<section class="policy">
    <h2>${esc(cancellation.title)}</h2>
    <p>Última revisão em ${esc(cancellation.revisedAt)}.</p>
    ${blocks}
  </section>`;
}

function footer(view: PublicQuoteView): string {
  const c = view.company;
  return `<footer>
    <b>${esc(c.name)}</b> · ${esc(c.tagline)}<br/>
    CNPJ ${esc(c.cnpj)} · Instagram @${esc(c.instagram)} · facebook.com/${esc(c.facebook)} · ${esc(c.site)}<br/>
    ${esc(c.hours)}
  </footer>`;
}

function header(view: PublicQuoteView): string {
  return `<header class="band">
    <img src="data:image/png;base64,${QUOTE_LOGO_WHITE_PNG_BASE64}" alt="${esc(view.company.name)}"/>
    <h1>Sua cotação</h1>
    ${view.customerName ? `<div class="who">Preparada para ${esc(view.customerName)}</div>` : ''}
    <div class="meta">
      <div>Código<b>#${esc(view.code)}</b></div>
      <div>Emitida em<b>${esc(spDateTime(new Date(view.createdAt)))}</b></div>
      <div>Válida até<b>${esc(spDateTime(new Date(view.expiresAt)))}</b></div>
    </div>
  </header>`;
}

/** HTML A4 da cotação. Tudo o que vem do banco passa por `esc`. */
export function buildQuotePdfHtml(view: PublicQuoteView, quoteUrl: string | null): string {
  const { quote } = view;
  const items = [...quote.items].sort(byDate).map((item, i) => itemBlock(item, i, quote.currency)).join('');
  return `<!doctype html><html lang="pt-BR"><head>${PDF_CSP_META}<meta charset="utf-8"/><style>${QUOTE_CSS}</style></head><body>
    ${header(view)}
    <main>${summary(quote)}<h2>Itens</h2>${items}${totalsBlock(quote, view.terms)}${closeBlock(view, quoteUrl)}${policyBlock(view.terms)}</main>
    ${footer(view)}
  </body></html>`;
}

@Injectable()
export class QuotePdfService {
  private readonly renderer: HtmlPdfRenderer;

  constructor(browserType: BrowserType = chromium) {
    this.renderer = new HtmlPdfRenderer(browserType);
  }

  async render(view: PublicQuoteView, quoteUrl: string | null): Promise<Buffer> {
    return this.renderer.render(buildQuotePdfHtml(view, quoteUrl), 'gerar a cotação');
  }
}
