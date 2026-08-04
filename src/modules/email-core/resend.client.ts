import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailConfig, loadEmailConfig } from './email.config';

export interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * URL da API (aceita POST), NÃO a página web — vai no header
   * `List-Unsubscribe`/`List-Unsubscribe-Post`, que Gmail/Outlook chamam
   * automaticamente sem abrir navegador. O link clicável do rodapé (página
   * web) já vem embutido em `html`/`text` pelo EmailRenderService.
   */
  unsubscribePostUrl: string;
  fromName?: string;
}

export interface SendEmailResult {
  providerId: string;
}

@Injectable()
export class ResendClient {
  private readonly config: EmailConfig;
  private readonly sdk: { emails: { send: (opts: any) => Promise<any> } };

  // O segundo parâmetro existe para o teste injetar um fake. Em produção o Nest
  // chama sem ele e a SDK real é construída aqui.
  constructor(config?: EmailConfig, sdk?: any) {
    this.config = config ?? loadEmailConfig(process.env);
    this.sdk = sdk ?? new Resend(this.config.apiKey);
  }

  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const from = payload.fromName ? `${payload.fromName} <${this.config.from}>` : this.config.from;

    let result: any;
    try {
      result = await this.sdk.emails.send({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        headers: {
          // Habilita o botão nativo de descadastro do Gmail/Outlook. Sem ele o
          // usuário marca spam em vez de descadastrar, e a reputação despenca.
          // Tem que ser a URL da API (aceita POST) — a página web só responde
          // GET e devolveria 405 pro POST automático do provedor.
          'List-Unsubscribe': `<${payload.unsubscribePostUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
    } catch (err) {
      // Nunca engolir: o motivo real é o que torna o erro depurável.
      throw new Error(`Resend falhou: ${(err as Error).message}`);
    }

    if (result?.error) {
      const { name, message } = result.error;
      throw new Error(`Resend recusou (${name ?? 'erro'}): ${message ?? JSON.stringify(result.error)}`);
    }
    const providerId = result?.data?.id;
    if (!providerId) {
      throw new Error(`Resend devolveu resposta sem id: ${JSON.stringify(result)}`);
    }
    return { providerId };
  }
}
