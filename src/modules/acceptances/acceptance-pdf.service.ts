import { Injectable } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import {
  AcceptanceItem,
  AcceptancePassenger,
  VoucherRef,
} from './acceptances.types';

export interface AcceptancePdfInput {
  organizationName: string;
  termText: string;
  /** Snapshot da política de cancelamento. Ausente/vazia = bloco não sai. */
  policyText?: string | null;
  items: AcceptanceItem[];
  signerName: string;
  signedAt: Date;
  signerIp?: string | null;
  vouchers?: VoucherRef[];
  orderRef?: string | null;
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

@Injectable()
export class AcceptancePdfService {
  constructor(private readonly browserType: BrowserType = chromium) {}

  /**
   * Passageiros nominais do item, como sub-lista DENTRO do `<li>` do item —
   * não como itens irmãos. Um nome no mesmo nível do produto lê como "mais uma
   * coisa entregue"; o que ele é, na verdade, é para quem o ingresso vale.
   *
   * `name` e `birthDate` passam pelo `esc()` como todo o resto: vêm de um
   * modelo de linguagem lendo texto colado pelo atendente, ou seja, do usuário.
   */
  private paxList(passengers: AcceptancePassenger[] | undefined): string {
    if (!passengers?.length) return '';
    const rows = passengers
      .map(
        (p) =>
          `<li>${esc(p.name)}${
            p.birthDate ? ` — nascimento: ${esc(p.birthDate)}` : ''
          }</li>`,
      )
      .join('');
    return `<ul class="pax">${rows}</ul>`;
  }

  private html(i: AcceptancePdfInput): string {
    // `qty` também passa pelo `esc()`. Hoje o `@IsNumber()` + pipe global já
    // recusariam markup, mas a regra deste arquivo é "tudo que vem do usuário
    // é escapado" — abrir exceção por ser "seguro na origem" ensina que a
    // regra é opcional e a próxima validação frouxa vira injeção.
    const rows = i.items.map((it) => `<li>${esc(it.description)}${
      it.qty ? ` — <strong>${esc(String(it.qty))}x</strong>` : ''}${it.date ? ` (${esc(it.date)})` : ''}${
      it.note ? ` — ${esc(it.note)}` : ''}${this.paxList(it.passengers)}</li>`).join('');
    const when = i.signedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    // O hash de cada voucher entra no comprovante como prova de qual arquivo
    // foi entregue. Arquivo ilegível no momento do hash fica sem `sha256` —
    // nesse caso o nome aparece sozinho, sem rótulo de hash vazio.
    const voucherRows = (i.vouchers ?? [])
      .map(
        (v) =>
          `<li>${esc(v.filename)}${
            v.sha256 ? ` — <code style="font-size:10px">SHA-256: ${esc(v.sha256)}</code>` : ''
          }</li>`,
      )
      .join('');
    const voucherBlock = voucherRows
      ? `<h3>Vouchers entregues</h3><ul>${voucherRows}</ul>`
      : '';
    const orderBlock = i.orderRef
      ? `<p><strong>Pedido:</strong> ${esc(i.orderRef)}</p>`
      : '';
    // O texto é livre e escrito pelo dono da org: passa pelo `esc()` como todo
    // o resto (o PDF é gerado por Chromium de verdade — HTML não escapado aqui
    // é injeção num documento legal) e mantém as quebras de linha via
    // `pre-wrap`, senão a política vira um parágrafo único ilegível.
    const policy = i.policyText?.trim();
    const policyBlock = policy
      ? `<h3>Política de cancelamento</h3><p class="policy">${esc(policy)}</p>`
      : '';
    // Exibir a política prova só que o texto estava na página. O que o
    // comprovante precisa provar é o ACEITE — por isso a declaração fica
    // dentro do bloco da assinatura, amarrada ao ato de assinar, e não solta
    // como mais um parágrafo. Fica fora do `termText` de propósito: o termo é
    // editável pelo atendente e já está snapshotado em aceites antigos, e esta
    // linha tem que sair sempre que houver política, seja qual for o termo.
    const policyConsent = policy
      ? '<div>Declarou ter lido e aceito a política de cancelamento acima.</div>'
      : '';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
      <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:40px;line-height:1.5}
      h1{font-size:20px}ul{padding-left:20px}.meta{margin-top:32px;font-size:12px;color:#444;border-top:1px solid #ddd;padding-top:16px}
      .policy{white-space:pre-wrap}
      .pax{margin:2px 0 6px;font-size:12px;color:#444;list-style:circle}</style>
      </head><body>
      <h1>Comprovante de Aceite — ${esc(i.organizationName)}</h1>
      ${orderBlock}
      <p>${esc(i.termText)}</p>
      <h3>Itens conferidos</h3><ul>${rows}</ul>
      ${voucherBlock}
      ${policyBlock}
      <div class="meta">
        <div><strong>Assinado por:</strong> ${esc(i.signerName)}</div>
        <div><strong>Data/hora:</strong> ${esc(when)} (Brasília)</div>
        ${i.signerIp ? `<div><strong>IP:</strong> ${esc(i.signerIp)}</div>` : ''}
        ${policyConsent}
        <div>Assinatura eletrônica simples (MP 2.200-2/2001).</div>
      </div></body></html>`;
  }

  async render(input: AcceptancePdfInput): Promise<Buffer> {
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(this.html(input), { waitUntil: 'load' });
      return (await page.pdf({ format: 'A4', printBackground: true })) as Buffer;
    } finally {
      await browser.close();
    }
  }
}
