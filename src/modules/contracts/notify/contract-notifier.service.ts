import { Injectable, Logger } from '@nestjs/common';
import type { Contract } from '@prisma/client';
import { ResendClient } from '../../email-core/resend.client';
import { ContractSettingsService } from '../contract-settings.service';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Assunto de e-mail é cabeçalho: sem quebra de linha nem tab. */
const oneLine = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ');

@Injectable()
export class ContractNotifierService {
  private readonly logger = new Logger(ContractNotifierService.name);

  constructor(
    private readonly resend: ResendClient,
    private readonly settings: ContractSettingsService,
  ) {}

  /**
   * O link aponta para o painel (com login), nunca para o arquivo. Sem URL
   * pública configurada vai sem link: link relativo não abre no e-mail.
   * Nunca lança: o comprovante já foi gravado quando isto roda.
   */
  async receiptUploaded(organizationId: string, c: Contract, panelUrl: string | null): Promise<void> {
    try {
      const { receiptNotifyEmail } = await this.settings.get(organizationId);
      if (!receiptNotifyEmail) return;
      const link = panelUrl ? `<p><a href="${esc(panelUrl)}">Abrir o contrato no Sendtur</a></p>` : '';
      const html = `<h2>✅ Comprovante recebido</h2>
      <p>Um cliente enviou o comprovante de pagamento.</p>
      <p><b>Cliente:</b> ${esc(c.fullName)}<br/><b>E-mail:</b> ${esc(c.email)}<br/><b>Guia:</b> ${esc(c.guideName)}</p>
      <p><b>Datas:</b><br/>${esc(c.requestedDates).replace(/\n/g, '<br/>')}</p>
      ${link}`;
      const text = `Comprovante recebido de ${c.fullName} (${c.email}).${panelUrl ? ` Abrir: ${panelUrl}` : ''}`;
      await this.resend.sendTransactional({
        to: receiptNotifyEmail,
        subject: `💰 Comprovante recebido — ${oneLine(c.fullName)}`,
        html,
        text,
      });
    } catch (err) {
      this.logger.warn(`contract_receipt_email_failed contract=${c.id} reason=${(err as Error).message}`);
    }
  }
}
