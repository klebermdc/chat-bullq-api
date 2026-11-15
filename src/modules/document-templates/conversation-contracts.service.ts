import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import { AcceptanceKind, AcceptanceStatus, DocumentTemplateAudience } from '@prisma/client';
import { AcceptancesService } from '../acceptances/acceptances.service';
import {
  AcceptanceStatusView,
  DeliverySendResult,
} from '../acceptances/acceptances.types';
import { MessagesService } from '../messaging/messages/messages.service';
import {
  ConversationActor,
  ConversationGuardService,
} from '../acceptances/conversation-guard.service';
import { DocumentTemplatesService } from './document-templates.service';
import { fillTemplate } from './placeholders.util';

export type ContractActor = ConversationActor;

/** Título usado no texto do link quando o aceite não tem título gravado. */
const FALLBACK_TITLE = 'Contrato';

export interface CreatedContractView extends AcceptanceStatusView {
  /** Link público de assinatura (`/aceite/<token>`). */
  link: string;
  /** Desfecho do envio do link no WhatsApp (enfileirado, não entregue). */
  send: DeliverySendResult;
}

export function contractLinkMessage(title: string, link: string): string {
  return `Segue o contrato *${title}* para leitura e aceite: ${link}`;
}

/** Motivo curto pro atendente; o texto cru da exceção fica no log. */
function sendFailureReason(err: unknown): string {
  if (err instanceof NotFoundException) return 'Conversa ou canal do cliente não encontrado.';
  if (err instanceof ForbiddenException) return 'Sem acesso a esta conversa.';
  if (err instanceof BadRequestException) return 'Envio recusado para esta conversa.';
  return 'Não foi possível enviar agora.';
}

/**
 * Contrato de modelo enviado ao cliente pela conversa. Reusa o aceite
 * (`OrderAcceptance` kind CONTRACT): mesmo token, mesma página pública, mesma
 * assinatura e mesmo PDF — aqui só se monta o texto e se manda o link.
 */
@Injectable()
export class ConversationContractsService {
  private readonly logger = new Logger(ConversationContractsService.name);

  constructor(
    private readonly templates: DocumentTemplatesService,
    private readonly acceptances: AcceptancesService,
    private readonly guard: ConversationGuardService,
    // Mesmo ciclo pipelines↔messaging: MessagingModule puxa meio app.
    @Inject(forwardRef(() => MessagesService))
    private readonly messages: MessagesService,
  ) {}

  /**
   * Outra org, conversa de colega (AGENT) ou canal sem acesso = 404, antes de
   * criar qualquer coisa — um aceite órfão não pode nascer de um pedido negado.
   */
  private assertCanUseConversation(actor: ContractActor, conversationId: string): Promise<void> {
    return this.guard.assertCanUse(actor, conversationId);
  }

  async list(actor: ContractActor, conversationId: string): Promise<AcceptanceStatusView[]> {
    await this.assertCanUseConversation(actor, conversationId);
    return this.acceptances.listContractsForConversation(actor.organizationId, conversationId);
  }

  async create(
    actor: ContractActor,
    conversationId: string,
    input: { templateId: string; values?: Record<string, string>; expiresInDays?: number },
  ): Promise<CreatedContractView> {
    await this.assertCanUseConversation(actor, conversationId);

    const template = await this.templates.findVisible(actor, input.templateId);
    if (template.audience !== DocumentTemplateAudience.CLIENT || !template.isActive) {
      throw new BadRequestException('Este modelo não é um contrato de cliente ativo.');
    }

    const { text, missing } = fillTemplate(template.body, input.values);
    if (missing.length > 0) {
      throw new UnprocessableEntityException({
        message: `Preencha todos os campos do contrato antes de enviar: ${missing.join(', ')}.`,
        missing,
      });
    }

    const { acceptance, link } = await this.acceptances.createForConversation(
      actor.organizationId,
      conversationId,
      {
        kind: AcceptanceKind.CONTRACT,
        title: template.title,
        templateId: template.id,
        items: [],
        termText: text,
        createdById: actor.userId,
        expiresInDays: input.expiresInDays,
      },
    );

    const send = await this.sendLink(actor, conversationId, contractLinkMessage(template.title, link));
    return { ...this.acceptances.toStatusView(acceptance), link, send };
  }

  /**
   * Reenvia o link de um contrato da conversa: renova o prazo (mesma duração
   * da criação) e manda a mesma mensagem de novo. Assinado = 409.
   */
  async resend(actor: ContractActor, conversationId: string, id: string): Promise<CreatedContractView> {
    await this.assertCanUseConversation(actor, conversationId);
    const current = await this.acceptances.findContractInConversation(actor.organizationId, conversationId, id);
    if (current.status === AcceptanceStatus.SIGNED) {
      throw new ConflictException('Este contrato já foi assinado.');
    }
    const { acceptance, link } = await this.acceptances.resend(actor.organizationId, id);
    const title = current.title ?? FALLBACK_TITLE;
    const send = await this.sendLink(actor, conversationId, contractLinkMessage(title, link));
    return { ...this.acceptances.toStatusView(acceptance), link, send };
  }

  /**
   * O aceite já existe quando o envio roda (mesma ordem da entrega): falha de
   * envio não apaga o contrato — o atendente reenvia pelo "Reenviar link".
   * Envio com o papel e os canais do usuário (sem `system`), automático para
   * não mexer em "Esperando"/dono da conversa.
   */
  private async sendLink(actor: ContractActor, conversationId: string, text: string): Promise<DeliverySendResult> {
    try {
      const message = await this.messages.send(
        { conversationId, type: 'TEXT', content: { text } } as any,
        actor.userId,
        actor.organizationId,
        actor.channelAccess,
        actor.role,
        { automated: true },
      );
      return { queued: true, messageId: (message as { id?: string } | undefined)?.id };
    } catch (err) {
      this.logger.warn(`link do contrato não enviado: ${(err as Error)?.message ?? err}`);
      return { queued: false, error: sendFailureReason(err) };
    }
  }
}
