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
import { AcceptanceKind, AcceptanceStatus, DocumentTemplate, DocumentTemplateAudience } from '@prisma/client';
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
import { extractPlaceholders, fillTemplate, normalizeValues } from './placeholders.util';
import { ContactPersonalDataService } from './personal-data.service';
import { buildDataRequestText, missingClientFields } from './data-request.util';

export type ContractActor = ConversationActor;

/** Título usado no texto do link quando o aceite não tem título gravado. */
const FALLBACK_TITLE = 'Contrato';

export interface CreatedContractView extends AcceptanceStatusView {
  /** Link público de assinatura (`/aceite/<token>`). */
  link: string;
  /** Desfecho do envio do link no WhatsApp (enfileirado, não entregue). */
  send: DeliverySendResult;
}

export interface DataRequestView {
  /** Texto da mensagem (o que foi ou seria enviado). */
  text: string;
  /** Campos do cliente que faltam, na ordem do modelo. */
  fields: string[];
  /** Só com `send: true`: desfecho do envio no WhatsApp. */
  send?: DeliverySendResult;
}

export const NOTHING_TO_REQUEST = 'Já temos todos os dados do cliente para este modelo.';

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
    private readonly personalData: ContactPersonalDataService,
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

    const template = await this.clientTemplate(actor, input.templateId);

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

    await this.rememberPersonalData(actor, acceptance.contactId, template, input.values);
    const send = await this.sendText(actor, conversationId, contractLinkMessage(template.title, link), 'link do contrato');
    return { ...this.acceptances.toStatusView(acceptance), link, send };
  }

  /**
   * "Pedir dados ao cliente": monta (e, com `send`, envia) a mensagem que
   * lista só os dados pessoais que o modelo pede e ainda não temos.
   */
  async requestData(
    actor: ContractActor,
    conversationId: string,
    input: { templateId: string; send: boolean },
  ): Promise<DataRequestView> {
    await this.assertCanUseConversation(actor, conversationId);
    const template = await this.clientTemplate(actor, input.templateId);
    const known = await this.templates.autofillTemplate(actor, template, conversationId);
    const { fields, labels } = missingClientFields(known.groups.client, known.values);
    if (labels.length === 0) {
      throw new UnprocessableEntityException(NOTHING_TO_REQUEST);
    }
    const text = buildDataRequestText({ contactName: known.contactName, title: template.title, labels });
    if (!input.send) return { text, fields };
    const send = await this.sendText(actor, conversationId, text, 'pedido de dados');
    return { text, fields, send };
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
    const send = await this.sendText(actor, conversationId, contractLinkMessage(title, link), 'link do contrato');
    return { ...this.acceptances.toStatusView(acceptance), link, send };
  }

  /** Modelo de contrato de cliente ativo visível ao ator; senão 404/400. */
  private async clientTemplate(actor: ContractActor, templateId: string): Promise<DocumentTemplate> {
    const template = await this.templates.findVisible(actor, templateId);
    if (template.audience !== DocumentTemplateAudience.CLIENT || !template.isActive) {
      throw new BadRequestException('Este modelo não é um contrato de cliente ativo.');
    }
    return template;
  }

  /**
   * Lembra no contato os dados pessoais preenchidos (CPF, RG, endereço…) para
   * o próximo contrato. Só campos do modelo; falha aqui só vai pro log (sem
   * valores) e nunca derruba o contrato já criado.
   */
  private async rememberPersonalData(
    actor: ContractActor,
    contactId: string,
    template: Pick<DocumentTemplate, 'body'>,
    values: Record<string, string> | undefined,
  ): Promise<void> {
    try {
      const inTemplate = new Set(extractPlaceholders(template.body));
      const own = Object.entries(normalizeValues(values)).filter(([key]) => inTemplate.has(key));
      await this.personalData.saveFromValues(actor.organizationId, contactId, Object.fromEntries(own), actor.userId);
    } catch (err) {
      // Só nome/código do erro: a mensagem do Prisma pode trazer os valores.
      const code = (err as { code?: string })?.code ?? (err as Error)?.name ?? 'erro';
      this.logger.warn(`dados pessoais não gravados contact=${contactId}: ${code}`);
    }
  }

  /**
   * O aceite já existe quando o envio roda (mesma ordem da entrega): falha de
   * envio não apaga o contrato — o atendente reenvia pelo "Reenviar link".
   * Envio com o papel e os canais do usuário (sem `system`), automático para
   * não mexer em "Esperando"/dono da conversa.
   */
  private async sendText(
    actor: ContractActor,
    conversationId: string,
    text: string,
    what: string,
  ): Promise<DeliverySendResult> {
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
      this.logger.warn(`${what} não enviado: ${(err as Error)?.message ?? err}`);
      return { queued: false, error: sendFailureReason(err) };
    }
  }
}
