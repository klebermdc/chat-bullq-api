import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentTemplate, DocumentTemplateAudience, OrgRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ConversationAccessService } from '../messaging/conversations/conversation-access.service';
import { AcceptancePdfService } from '../acceptances/acceptance-pdf.service';
import { canSeeTemplate, isTemplateManager } from './document-template-access';
import {
  DocumentTemplateDetail,
  DocumentTemplateSummary,
  toDetail,
  toSummary,
} from './document-template.view';
import { FillResult, extractPlaceholders, fillTemplate } from './placeholders.util';
import { buildAutofill } from './autofill.util';
import {
  CreateDocumentTemplateDto,
  UpdateDocumentTemplateDto,
} from './dto/document-template.dto';

/** Quem está pedindo: org do JWT + papel + usuário. */
export interface TemplateActor {
  organizationId: string;
  role: OrgRole | undefined;
  userId: string;
}

const NOT_FOUND = 'Modelo não encontrado.';

@Injectable()
export class DocumentTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationAccess: ConversationAccessService,
    private readonly pdf: AcceptancePdfService,
  ) {}

  async list(
    actor: TemplateActor,
    query: { audience?: DocumentTemplateAudience; includeInactive?: boolean },
  ): Promise<DocumentTemplateSummary[]> {
    const manager = isTemplateManager(actor.role);
    if (!manager && query.audience === DocumentTemplateAudience.INTERNAL) {
      throw new ForbiddenException('Só administradores veem os modelos internos.');
    }
    if (!manager && query.includeInactive) {
      throw new ForbiddenException('Só administradores veem os modelos desativados.');
    }
    const audience = manager ? query.audience : DocumentTemplateAudience.CLIENT;
    const rows = await this.prisma.documentTemplate.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(audience ? { audience } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toSummary);
  }

  /**
   * Modelo visível para o ator. Fora da org ou fora do papel = 404 (não 403),
   * para não confirmar a existência de um modelo interno a quem não pode vê-lo.
   */
  async findVisible(actor: TemplateActor, id: string): Promise<DocumentTemplate> {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!template || !canSeeTemplate(actor.role, template)) {
      throw new NotFoundException(NOT_FOUND);
    }
    return template;
  }

  async get(actor: TemplateActor, id: string): Promise<DocumentTemplateDetail> {
    return toDetail(await this.findVisible(actor, id));
  }

  async create(actor: TemplateActor, dto: CreateDocumentTemplateDto): Promise<DocumentTemplateDetail> {
    const created = await this.prisma.documentTemplate.create({
      data: {
        organizationId: actor.organizationId,
        title: dto.title,
        category: dto.category,
        audience: dto.audience,
        body: dto.body,
        createdById: actor.userId,
      },
    });
    return toDetail(created);
  }

  async update(
    actor: TemplateActor,
    id: string,
    dto: UpdateDocumentTemplateDto,
  ): Promise<DocumentTemplateDetail> {
    await this.assertExistsInOrg(actor.organizationId, id);
    const updated = await this.prisma.documentTemplate.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return toDetail(updated);
  }

  /** Exclusão suave: o modelo some das listas, contratos já enviados ficam. */
  async deactivate(actor: TemplateActor, id: string): Promise<DocumentTemplateDetail> {
    return this.update(actor, id, { isActive: false });
  }

  /**
   * Valores pré-preenchidos para os campos do modelo. Com `conversationId`,
   * os dados do cliente vêm do contato daquela conversa — e a conversa passa
   * pela mesma guarda de acesso do envio (outra org/outro vendedor = 404).
   */
  async autofill(
    actor: TemplateActor,
    id: string,
    conversationId?: string,
  ): Promise<{ values: Record<string, string> }> {
    const template = await this.findVisible(actor, id);
    const [settings, contact] = await Promise.all([
      this.prisma.contractSettings.findUnique({
        where: { organizationId: actor.organizationId },
        select: { companyName: true, companyDocument: true, companyAddress: true },
      }),
      conversationId ? this.contactOfConversation(actor, conversationId) : Promise.resolve(null),
    ]);
    const values = buildAutofill({
      placeholders: extractPlaceholders(template.body),
      settings,
      contact,
      now: new Date(),
    });
    return { values };
  }

  async render(actor: TemplateActor, id: string, values?: Record<string, string>): Promise<FillResult> {
    const template = await this.findVisible(actor, id);
    return fillTemplate(template.body, values);
  }

  /** PDF do texto preenchido (sem assinatura), com título e nome da org. */
  async pdfFor(
    actor: TemplateActor,
    id: string,
    values?: Record<string, string>,
  ): Promise<{ buffer: Buffer; title: string }> {
    const template = await this.findVisible(actor, id);
    const org = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    const { text } = fillTemplate(template.body, values);
    const buffer = await this.pdf.renderDocument({
      organizationName: org?.name ?? '',
      title: template.title,
      text,
    });
    return { buffer, title: template.title };
  }

  private async assertExistsInOrg(organizationId: string, id: string): Promise<void> {
    const found = await this.prisma.documentTemplate.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
  }

  private async contactOfConversation(actor: TemplateActor, conversationId: string) {
    const conversation = await this.conversationAccess.assertConversationAccess(
      conversationId,
      actor.organizationId,
      actor.role,
      actor.userId,
      { allowParticipant: true },
    );
    return this.prisma.contact.findFirst({
      where: { id: conversation.contactId, organizationId: actor.organizationId },
      select: { name: true, phone: true, email: true },
    });
  }
}
