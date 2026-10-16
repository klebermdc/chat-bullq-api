import { Injectable } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';

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

export function buildContractHtml(i: ContractPdfInput): string {
  const c = i.contract;
  const amount = c.amount.trim().startsWith('$') ? c.amount : `R$ ${c.amount}`;
  const dates = c.dates.length
    ? c.dates.map((d) => `<li>${esc(brDate(d.date))} — ${esc(d.label)}</li>`).join('')
    : '<li>Datas a definir</li>';
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const a = i.acceptance;
  const evidence = a
    ? `<section class="evidence"><h2>Aceite eletrônico</h2>
        ${a.signaturePngBase64 ? `<img class="sig" src="data:image/png;base64,${a.signaturePngBase64}" alt="Assinatura"/>` : ''}
        <table>${row('Aceito em', `${spDateTime(a.acceptedAt)} (horário de Brasília)`)}${row('IP', a.ip ?? '—')}${row('Navegador', a.userAgent ?? '—')}</table></section>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;margin:32px}
    h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
    table{border-collapse:collapse;width:100%} th{text-align:left;width:30%;color:#555;font-weight:normal;padding:2px 0} td{padding:2px 0}
    .terms{white-space:pre-wrap;line-height:1.45} .sig{max-height:90px;margin:6px 0;border-bottom:1px solid #999}
    .evidence{page-break-inside:avoid}
  </style></head><body>
    <h1>${esc(i.company.name)}</h1><div>Contrato de prestação de serviço de guiamento</div>
    <h2>1. Contratante</h2><table>${row('Nome', c.fullName)}${row('CPF', c.cpf)}${row('Endereço', c.address)}${row('CEP', c.cep)}${row('E-mail', c.email)}${row('Telefone', c.phone)}</table>
    <h2>2. Contratada</h2><table>${row('Empresa', i.company.name)}${row('CNPJ', i.company.document)}${row('Endereço', i.company.address)}</table>
    <h2>3. Serviço</h2><table>${row('Guia', c.guideName)}${row('Pessoas', c.people)}${row('Dias', c.days)}${row('Pagamento', c.paymentMethod ?? 'À vista')}${row('Valor total', amount)}</table>
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
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(buildContractHtml(input), { waitUntil: 'load' });
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
    } finally {
      await browser.close();
    }
  }
}
