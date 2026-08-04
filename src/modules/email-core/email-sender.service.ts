import { Injectable, Logger } from '@nestjs/common';
import { EmailMessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EmailContent } from './email-blocks.types';
import { EmailRenderService } from './email-render.service';
import { ResendClient } from './resend.client';
import { EmailConfig, loadEmailConfig } from './email.config';
import { signUnsubscribeToken } from './unsubscribe-token.util';

export interface SendRequest {
  organizationId: string;
  subscriberId?: string;
  campaignId?: string;
  to: string;
  name?: string;
  subject: string;
  preheader?: string;
  fromName?: string;
  content: EmailContent;
  /** Chave de idempotência. Com ela, reenviar não duplica. */
  dedupKey?: string;
}

@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);
  private readonly config: EmailConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: EmailRenderService,
    private readonly resend: ResendClient,
    config?: EmailConfig,
  ) {
    this.config = config ?? loadEmailConfig(process.env);
  }

  private unsubscribeToken(subscriberId: string): string {
    return signUnsubscribeToken(subscriberId, this.config.unsubscribeSecret);
  }

  /**
   * Link da PÁGINA web (Next `page.tsx`, só responde GET) — vai no rodapé
   * visível do email, para a pessoa clicar e ver a tela de confirmação.
   */
  unsubscribePageUrl(subscriberId: string): string {
    return `${this.config.publicUrl}/descadastro/${this.unsubscribeToken(subscriberId)}`;
  }

  /**
   * Link da API (aceita POST) — vai no header `List-Unsubscribe` /
   * `List-Unsubscribe-Post`, que Gmail/Outlook chamam automaticamente sem
   * abrir navegador. Apontar esse header para a página web devolve 405 (ela
   * só responde GET) e o provedor passa a tratar o descadastro do domínio
   * como quebrado — o oposto do que a feature tenta evitar.
   */
  unsubscribePostUrl(subscriberId: string): string {
    return `${this.config.apiUrl}/api/v1/public/unsubscribe/${this.unsubscribeToken(subscriberId)}`;
  }

  /**
   * Envia um email e devolve a linha de `email_messages`.
   *
   * NUNCA lança por falha do provedor: grava `FAILED` com o motivo real e
   * devolve. Quem chama decide se tenta de novo. Lançar aqui faria o worker
   * repetir o envio de um email que talvez já tenha saído.
   */
  async send(req: SendRequest) {
    if (req.dedupKey) {
      const existing = await this.prisma.emailMessage.findUnique({
        where: { dedupKey: req.dedupKey },
      });
      // Já processada — não reenvia. PENDING segue adiante (retomada).
      if (existing && existing.status !== EmailMessageStatus.PENDING) return existing;
    }

    let message = req.dedupKey
      ? await this.prisma.emailMessage.findUnique({ where: { dedupKey: req.dedupKey } })
      : null;

    if (!message) {
      try {
        message = await this.prisma.emailMessage.create({
          data: {
            organizationId: req.organizationId,
            campaignId: req.campaignId ?? null,
            subscriberId: req.subscriberId ?? null,
            to: req.to,
            subject: req.subject,
            dedupKey: req.dedupKey ?? null,
            status: EmailMessageStatus.PENDING,
          },
        });
      } catch (err: any) {
        // Corrida entre dois workers no mesmo dedupKey: o banco recusou a
        // duplicata, então o outro já está cuidando desta mensagem.
        if (err?.code === 'P2002' && req.dedupKey) {
          return this.prisma.emailMessage.findUnique({ where: { dedupKey: req.dedupKey } });
        }
        throw err;
      }
    }

    // Mesmo subscriberId (mesmo token) alimenta os dois destinos — o rodapé
    // visível (página web) e o header automático (API) precisam concordar
    // sobre quem está se descadastrando. Os DOMÍNIOS, porém, são
    // propositalmente diferentes: `unsubscribePageUrl` usa `publicUrl` (web,
    // ex. ofpchat.explotek.pro) porque é a pessoa quem clica e espera ver uma
    // tela; `unsubscribePostUrl` usa `apiUrl` (API, ex.
    // api-ofpchat.explotek.pro) porque é o robô do Gmail/Outlook chamando o
    // header `List-Unsubscribe-Post` direto contra a rota da API, sem
    // navegador. Misturar os dois faz um deles bater num domínio que não
    // serve aquela rota e devolver 404.
    const subscriberId = req.subscriberId ?? message!.id;
    const unsubscribePageUrl = this.unsubscribePageUrl(subscriberId);
    const unsubscribePostUrl = this.unsubscribePostUrl(subscriberId);

    try {
      const { html, text } = await this.renderer.render(
        req.content,
        { nome: req.name, email: req.to },
        unsubscribePageUrl,
        req.preheader,
      );
      const { providerId } = await this.resend.send({
        to: req.to,
        subject: req.subject,
        html,
        text,
        unsubscribePostUrl,
        fromName: req.fromName,
      });
      return await this.prisma.emailMessage.update({
        where: { id: message!.id },
        data: { status: EmailMessageStatus.SENT, providerId, sentAt: new Date() },
      });
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`envio falhou para ${req.to}: ${reason}`);
      return this.prisma.emailMessage.update({
        where: { id: message!.id },
        data: { status: EmailMessageStatus.FAILED, failedReason: reason },
      });
    }
  }
}
