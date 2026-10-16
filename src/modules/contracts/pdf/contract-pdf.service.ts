import { Injectable } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import { RenderSemaphore } from './render-semaphore';

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

const SP_TIME_ZONE = 'America/Sao_Paulo';
const MAX_SIGNATURE_BASE64_LENGTH = 700_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;
const SET_CONTENT_TIMEOUT_MS = 15_000;
const PDF_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_RENDERS = 2;

/** Compartilhado pelo processo: no máximo 2 Chromium gerando PDF ao mesmo tempo. */
const renderSemaphore = new RenderSemaphore(MAX_CONCURRENT_RENDERS);

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const brDate = (iso: string) => iso.split('-').reverse().join('/');

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

export function buildContractHtml(i: ContractPdfInput): string {
  const c = i.contract;
  const amount = c.amount.trim().startsWith('$') ? c.amount : `R$ ${c.amount}`;
  const dates = c.dates.length
    ? c.dates.map((d) => `<li>${esc(brDate(d.date))} — ${esc(d.label)}</li>`).join('')
    : '<li>Datas a definir</li>';
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const a = i.acceptance;
  if (a?.signaturePngBase64 != null) assertValidSignature(a.signaturePngBase64);
  const evidence = a
    ? `<section class="evidence"><h2>Aceite eletrônico</h2>
        ${a.signaturePngBase64 != null ? `<img class="sig" src="data:image/png;base64,${a.signaturePngBase64}" alt="Assinatura"/>` : ''}
        <table>${row('Aceito em', `${spDateTime(a.acceptedAt)} (horário de Brasília)`)}${row('IP', a.ip ?? '—')}${row('Navegador', a.userAgent ?? '—')}</table></section>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head>${CSP_META}<meta charset="utf-8"/><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;margin:32px}
    h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
    table{border-collapse:collapse;width:100%} th{text-align:left;width:30%;color:#555;font-weight:normal;padding:2px 0} td{padding:2px 0}
    .terms{white-space:pre-wrap;line-height:1.45} .sig{max-height:90px;margin:6px 0;border-bottom:1px solid #999}
    .evidence{page-break-inside:avoid}
  </style></head><body>
    <h1>${esc(i.company.name)}</h1><div>Contrato de prestação de serviço de guiamento</div>
    <h2>1. Contratante</h2><table>${row('Nome', c.fullName)}${row('CPF', c.cpf)}${row('Endereço', c.address)}${row('CEP', c.cep)}${row('E-mail', c.email)}${row('Telefone', c.phone)}</table>
    <h2>2. Contratada</h2><table>${row('Empresa', i.company.name)}${row('CNPJ', i.company.document)}${row('Endereço', i.company.address)}</table>
    <h2>3. Serviço</h2><table>${row('Guia', c.guideName)}${row('Pessoas', c.people)}${row('Dias', c.days)}${row('Pagamento', paymentLabel(c.paymentMethod))}${row('Valor total', amount)}</table>
    <ul>${dates}</ul>
    <h2>4. Observações</h2><div class="terms">${esc(c.notes || 'Sem observações.')}</div>
    <h2>5. Termos</h2><div class="terms">${esc(a ? a.acceptedTerms : i.terms)}</div>
    ${evidence}
  </body></html>`;
}

@Injectable()
export class ContractPdfService {
  constructor(private readonly browserType: BrowserType = chromium) {}

  async render(input: ContractPdfInput): Promise<Buffer> {
    const html = buildContractHtml(input); // valida antes de ocupar vaga e abrir navegador
    return renderSemaphore.run(() => this.renderHtml(html));
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
