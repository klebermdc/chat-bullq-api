import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import { RenderQueueFullError, RenderQueueTimeoutError, RenderSemaphore } from './render-semaphore';

export interface ContractPdfInput {
  company: { name: string; document: string; address: string };
  contract: {
    fullName: string; cpf: string; address: string; cep: string; email: string; phone: string;
    guideName: string; people: number; days: number; amount: string;
    paymentMethod: string | null; notes: string | null;
    dates: { label: string; date: string }[];
  };
  terms: string;
  acceptance?: {
    acceptedAt: Date; ip: string | null; userAgent: string | null;
    signaturePngBase64: string | null; acceptedTerms: string;
  };
}

/** Textos fixos do modelo oficial. */
export const PDF_TAGLINE = 'A Magia da Disney nas suas mãos';
export const PDF_SIGNATURE_ROLE = 'CONSULTORIA E ESTRATÉGIA MÁGICA';

const SP_TIME_ZONE = 'America/Sao_Paulo';
const MAX_SIGNATURE_BASE64_LENGTH = 700_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;
const SET_CONTENT_TIMEOUT_MS = 15_000;
const PDF_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_RENDERS = 2;
const MAX_QUEUE = 10;
const MAX_QUEUE_WAIT_MS = 25_000;
const TOTAL_RENDER_TIMEOUT_MS = 45_000; // inclui a espera na fila
const BUSY_MESSAGE = 'Gerador de PDF ocupado, tente de novo em instantes';

/** Compartilhado pelo processo: no máximo 2 Chromium gerando PDF ao mesmo tempo, fila de até 10. */
const renderSemaphore = new RenderSemaphore(MAX_CONCURRENT_RENDERS, { maxQueue: MAX_QUEUE, maxWaitMs: MAX_QUEUE_WAIT_MS });

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const spFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "dd/MM/yyyy HH:mm" em America/Sao_Paulo, montado por partes (independe do separador do ICU). */
export const spDateTime = (d: Date): string => {
  const p = Object.fromEntries(spFormatter.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};

/** A assinatura virá do cliente: só aceita base64 puro de um PNG de tamanho razoável. */
function assertValidSignature(b64: string): void {
  const ok =
    b64.length <= MAX_SIGNATURE_BASE64_LENGTH &&
    BASE64_RE.test(b64) &&
    Buffer.from(b64, 'base64').subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
  if (!ok) throw new Error('Assinatura inválida');
}

const CARD_INSTALLMENTS_RE = /^cartao-(\d{1,2})x$/;

/** Forma de pagamento legível; valor desconhecido sai como veio (escapado na renderização). */
export function paymentLabel(method: string | null): string {
  if (method == null) return 'À vista';
  if (method === 'pix') return 'PIX à vista';
  if (method === 'dolar') return 'Dólar (Wise/ACH)';
  const card = CARD_INSTALLMENTS_RE.exec(method);
  return card ? `Cartão em ${Number(card[1])}x` : method;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado ao ${what} (${ms} ms)`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const PURPLE = '#8B008B';
const GOLD = '#D4A520';

/** Fontes só do sistema: a rede do navegador fica bloqueada por design. */
const SERIF = `Georgia,'Times New Roman',Times,serif`;
const SANS = `Helvetica,Arial,sans-serif`;

/**
 * Moldura fixa (o Chromium repete elementos fixed em toda página) e tabela externa com
 * thead/tfoot vazios, que se repetem em cada página e dão o respiro de cima e de baixo.
 */
const CONTRACT_CSS = `
  @page{size:A4;margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff}
  body{font-family:${SANS};font-size:11px;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .frame{position:fixed;top:7mm;right:7mm;bottom:7mm;left:7mm;border:11px solid ${GOLD}}
  .page{width:100%;table-layout:fixed;border-collapse:collapse}
  .page>thead td,.page>tfoot td{height:17mm;padding:0}
  .page>tbody>tr>td{padding:0 19mm}
  header{text-align:center;margin-bottom:14px}
  .brand{font-family:${SERIF};font-style:italic;font-size:34px;color:${PURPLE};line-height:1.1}
  .tagline{color:#777;font-size:12px;margin-top:4px}
  .rule{width:60%;margin:10px auto 12px;border-top:2px solid #000}
  .title{font-weight:bold;font-size:15px;letter-spacing:.3px}
  h2{color:${PURPLE};font-size:12.5px;font-weight:bold;text-transform:uppercase;margin:16px 0 6px;break-after:avoid;page-break-after:avoid}
  .grid{width:100%;border-collapse:collapse;table-layout:fixed;break-inside:avoid;page-break-inside:avoid}
  .grid td{border:1px solid #000;padding:5px 7px;vertical-align:top;font-size:11px;overflow-wrap:anywhere;word-break:break-word}
  .notes{border:1px solid #000;padding:8px 10px;font-style:italic;white-space:pre-wrap;line-height:1.45;overflow-wrap:anywhere;word-break:break-word}
  .terms{white-space:pre-wrap;font-size:10.5px;line-height:1.5;text-align:justify;overflow-wrap:anywhere;word-break:break-word}
  .signatures{page-break-inside:avoid;break-inside:avoid;display:flex;gap:48px;margin-top:36px}
  .sig-col{flex:1;text-align:center}
  .sig-mark{height:64px;display:flex;align-items:flex-end;justify-content:center}
  .sig-img{max-height:60px;max-width:100%}
  .guide-sign{font-family:${SERIF};font-style:italic;font-size:28px;line-height:1;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
  .sig-line{border-top:1px solid #000;margin:4px 0 5px}
  .sig-name{font-size:10px;margin-top:2px;overflow-wrap:anywhere;word-break:break-word}
  .sig-role{color:${PURPLE};font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-top:2px}
  .evidence{page-break-inside:avoid;break-inside:avoid;margin-top:22px;background:#f4f4f4;border:1px solid #ccc;padding:8px 10px;font-size:9.5px;color:#444}
  .evidence h3{font-size:10px;margin:0 0 4px;color:#333}
  .evidence div{margin:1px 0}
`;

/** "2026-12-11" → "11/12" (o modelo oficial não mostra o ano). */
const dayMonth = (iso: string) => {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
};

const upper = (s: string) => s.toLocaleUpperCase('pt-BR');

/** Célula de quadro: rótulo em negrito + valor escapado. */
const cell = (label: string, value: unknown, span = 1) =>
  `<td${span > 1 ? ` colspan="${span}"` : ''}><b>${esc(label)}:</b> ${esc(value)}</td>`;

const gridTable = (rows: string[]) => `<table class="grid">${rows.map((r) => `<tr>${r}</tr>`).join('')}</table>`;

const formatAmount = (amount: string) => (amount.trim().startsWith('$') ? amount : `R$ ${amount}`);

function parksCell(dates: ContractPdfInput['contract']['dates']): string {
  const lines = dates.length
    ? dates.map((d) => `<div>${esc(dayMonth(d.date))} - ${esc(d.label)}</div>`).join('')
    : '<div>Datas a definir</div>';
  return `<td colspan="2"><b>Parques:</b>${lines}</td>`;
}

function signaturesBlock(i: ContractPdfInput, signaturePng: string | null): string {
  const sigImg = signaturePng != null
    ? `<img class="sig-img" src="data:image/png;base64,${signaturePng}" alt="Assinatura"/>`
    : '';
  return `<section class="signatures">
    <div class="sig-col">
      <div class="sig-mark">${sigImg}</div><div class="sig-line"></div>
      <div><b>Assinatura do Contratante</b></div>
      <div class="sig-name">${esc(upper(i.contract.fullName))}</div>
    </div>
    <div class="sig-col">
      <div class="sig-mark"><div class="guide-sign">${esc(i.contract.guideName)}</div></div><div class="sig-line"></div>
      <div><b>${esc(i.company.name)}</b></div>
      <div class="sig-role">${esc(PDF_SIGNATURE_ROLE)}</div>
    </div>
  </section>`;
}

function evidenceBlock(a: NonNullable<ContractPdfInput['acceptance']>): string {
  return `<section class="evidence"><h3>Registro do aceite eletrônico</h3>
    <div>Aceito em ${esc(spDateTime(a.acceptedAt))} (horário de Brasília)</div>
    <div><b>IP:</b> ${esc(a.ip ?? '—')}</div>
    <div><b>Navegador:</b> ${esc(a.userAgent ?? '—')}</div></section>`;
}

function contractBody(i: ContractPdfInput): string {
  const c = i.contract;
  const a = i.acceptance;
  return `<header>
      <div class="brand">Orlando Fast Pass</div>
      <div class="tagline">${esc(PDF_TAGLINE)}</div>
      <div class="rule"></div>
      <div class="title">CONTRATO DE PRESTAÇÃO DE SERVIÇOS</div>
    </header>
    <h2>1. DADOS DO VIAJANTE (CONTRATANTE)</h2>
    ${gridTable([
      cell('Cliente', c.fullName) + cell('CPF', c.cpf),
      cell('Endereço', c.address, 2),
      cell('E-mail', c.email) + cell('Telefone', c.phone),
      cell('CEP', c.cep, 2),
    ])}
    <h2>2. DADOS DA CONTRATADA (${esc(upper(i.company.name))})</h2>
    ${gridTable([cell('Razão Social', i.company.name) + cell('CNPJ', i.company.document), cell('Endereço', i.company.address, 2)])}
    <h2>3. DETALHES DA AVENTURA</h2>
    ${gridTable([
      cell('Guia Mágico', c.guideName) + cell('Pessoas', c.people),
      cell('Qtd Dias', c.days) + cell('Pagamento', paymentLabel(c.paymentMethod)),
      cell('Valor Total', formatAmount(c.amount), 2),
      parksCell(c.dates),
    ])}
    <h2>4. OBSERVAÇÕES E SOLICITAÇÕES</h2>
    <div class="notes">${esc(c.notes || 'Sem observações.')}</div>
    <h2>5. DIZERES, TERMOS E CONDIÇÕES</h2>
    <div class="terms">${esc(a ? a.acceptedTerms : i.terms)}</div>
    ${signaturesBlock(i, a?.signaturePngBase64 ?? null)}
    ${a ? evidenceBlock(a) : ''}`;
}

export function buildContractHtml(i: ContractPdfInput): string {
  const sig = i.acceptance?.signaturePngBase64;
  if (sig != null) assertValidSignature(sig);
  return `<!doctype html><html lang="pt-BR"><head>${CSP_META}<meta charset="utf-8"/><style>${CONTRACT_CSS}</style></head><body>
    <div class="frame"></div>
    <table class="page"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot>
    <tbody><tr><td>${contractBody(i)}</td></tr></tbody></table>
  </body></html>`;
}

@Injectable()
export class ContractPdfService {
  constructor(private readonly browserType: BrowserType = chromium) {}

  async render(input: ContractPdfInput): Promise<Buffer> {
    const html = buildContractHtml(input); // valida antes de ocupar vaga e abrir navegador
    const startedAt = Date.now();
    try {
      return await renderSemaphore.run(() => {
        const remainingMs = Math.max(TOTAL_RENDER_TIMEOUT_MS - (Date.now() - startedAt), 1);
        return withTimeout(this.renderHtml(html), remainingMs, 'gerar o contrato');
      });
    } catch (err) {
      if (err instanceof RenderQueueFullError || err instanceof RenderQueueTimeoutError) {
        throw new ServiceUnavailableException(BUSY_MESSAGE);
      }
      throw err;
    }
  }

  private async renderHtml(html: string): Promise<Buffer> {
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
      await page.setContent(html, { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS });
      const pdf = await withTimeout(page.pdf({ format: 'A4', printBackground: true }), PDF_TIMEOUT_MS, 'gerar o PDF');
      return Buffer.from(pdf);
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close();
    }
  }
}
