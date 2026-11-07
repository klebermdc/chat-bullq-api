import { Injectable } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { WhatsAppOfficialHttpClient } from '../../channel-hub/adapters/whatsapp-official/whatsapp-official.http-client';
import type { ManagerRecipient } from './manager-alerts.config';
import { buildTemplatePayload } from './manager-alerts.payload';

export interface RecipientResult {
  phone: string;
  ok: boolean;
  wamid?: string;
  error?: string;
}

/**
 * Envia o template DIRETO pela Graph API do canal (POST /{phoneNumberId}/messages).
 * De propósito NÃO passa pelo MessagesService/fila de saída: não cria
 * contato, conversa nem mensagem no inbox, então o aviso interno não entra
 * no SLA, nas cadências, no roteamento nem na Aline.
 * Nunca lança: cada destinatário volta com ok/erro (o erro da Meta vem legível).
 */
@Injectable()
export class ManagerAlertsSender {
  constructor(private readonly waOfficial: WhatsAppOfficialHttpClient) {}

  async sendToAll(
    channel: Channel,
    recipients: ReadonlyArray<ManagerRecipient>,
    template: { name: string; language: string },
    paramsFor: (recipient: ManagerRecipient) => string[],
  ): Promise<RecipientResult[]> {
    const results: RecipientResult[] = [];
    // Sequencial: são 2–3 gestores; evita rajada no mesmo número.
    for (const recipient of recipients) {
      results.push(await this.sendOne(channel, recipient, template, paramsFor(recipient)));
    }
    return results;
  }

  private async sendOne(
    channel: Channel,
    recipient: ManagerRecipient,
    template: { name: string; language: string },
    params: string[],
  ): Promise<RecipientResult> {
    try {
      const payload = buildTemplatePayload(recipient.phone, template.name, template.language, params);
      const response = await this.waOfficial.sendMessage(channel, payload);
      const wamid: string | undefined = response?.messages?.[0]?.id;
      return { phone: recipient.phone, ok: true, ...(wamid ? { wamid } : {}) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { phone: recipient.phone, ok: false, error };
    }
  }
}
