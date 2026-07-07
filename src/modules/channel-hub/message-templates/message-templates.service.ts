import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { MessageTemplatesRepository } from './message-templates.repository';
import { WhatsAppOfficialHttpClient } from '../adapters/whatsapp-official/whatsapp-official.http-client';
import { ChannelsService } from '../channels/channels.service';
import { toGraphComponents } from './template-components.mapper';
import { mapMetaTemplateStatus, normalizeRejectionReason } from './template-status.mapper';
import {
  validateTemplateName,
  assertExamplesComplete,
} from './template-validation';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import {
  TemplateComponents,
  VariableExamples,
} from './template-components.types';

@Injectable()
export class MessageTemplatesService {
  constructor(
    private readonly repo: MessageTemplatesRepository,
    private readonly http: WhatsAppOfficialHttpClient,
    private readonly channels: ChannelsService,
  ) {}

  async create(orgId: string, channelId: string, dto: CreateTemplateDto) {
    if (!validateTemplateName(dto.name)) {
      throw new BadRequestException(
        'Nome inválido: use apenas minúsculas, números e _',
      );
    }
    await this.requireOfficialChannel(orgId, channelId);
    return this.repo.create({
      organizationId: orgId,
      channelId,
      name: dto.name,
      displayName: dto.displayName,
      category: dto.category,
      language: dto.language ?? 'pt_BR',
      status: 'DRAFT',
      components: dto.components as any,
      variableExamples: (dto.variableExamples ?? {}) as any,
    });
  }

  list(orgId: string, channelId: string) {
    return this.repo.findManyByChannel(orgId, channelId);
  }

  async update(orgId: string, id: string, dto: UpdateTemplateDto) {
    const t = await this.mustFind(orgId, id);
    if (!['DRAFT', 'REJECTED'].includes(t.status)) {
      throw new BadRequestException(
        'Só é possível editar rascunho ou rejeitado',
      );
    }
    if (dto.name && !validateTemplateName(dto.name)) {
      throw new BadRequestException('Nome inválido');
    }
    return this.repo.update(id, {
      ...(dto.name && { name: dto.name }),
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.category && { category: dto.category }),
      ...(dto.language && { language: dto.language }),
      ...(dto.components && { components: dto.components as any }),
      ...(dto.variableExamples && {
        variableExamples: dto.variableExamples as any,
      }),
    });
  }

  async submit(orgId: string, id: string) {
    const t = await this.mustFind(orgId, id);
    const channel = await this.requireOfficialChannel(orgId, t.channelId);
    const components = t.components as unknown as TemplateComponents;
    const examples = (t.variableExamples ?? {}) as VariableExamples;
    assertExamplesComplete(components.body.text, examples);
    const payload = {
      name: t.name,
      language: t.language,
      category: t.category as 'MARKETING' | 'UTILITY',
      components: toGraphComponents(components, examples),
    };
    const res = await this.http.createTemplate(channel, payload);
    return this.repo.update(id, {
      status: mapMetaTemplateStatus(res.status),
      metaTemplateId: res.id,
      submittedAt: new Date(),
    });
  }

  async sync(orgId: string, channelId: string) {
    const channel = await this.requireOfficialChannel(orgId, channelId);
    const remote = await this.http.listTemplates(channel);
    for (const r of remote) {
      await this.repo.updateByMetaId(r.id, {
        status: mapMetaTemplateStatus(r.status),
        reviewedAt: new Date(),
      });
    }
    return this.repo.findManyByChannel(orgId, channelId);
  }

  async applyStatusUpdate(
    metaTemplateId: string,
    status: string,
    rejectionReason?: string,
  ) {
    const mapped = mapMetaTemplateStatus(status);
    return this.repo.updateByMetaId(metaTemplateId, {
      status: mapped,
      rejectionReason: normalizeRejectionReason(rejectionReason) ?? null,
      reviewedAt: new Date(),
    });
  }

  async remove(orgId: string, id: string) {
    const t = await this.mustFind(orgId, id);
    if (t.metaTemplateId) {
      const channel = await this.requireOfficialChannel(orgId, t.channelId);
      await this.http
        .deleteTemplate(channel, t.name, t.metaTemplateId)
        .catch(() => undefined);
    }
    return this.repo.delete(id);
  }

  async uploadHeaderMedia(
    orgId: string,
    channelId: string,
    file: { buffer: Buffer; fileName: string; mimeType: string },
  ) {
    const channel = await this.requireOfficialChannel(orgId, channelId);
    const handle = await this.http.uploadHeaderSample(channel, file);
    return { handle };
  }

  private async mustFind(orgId: string, id: string) {
    const t = await this.repo.findById(orgId, id);
    if (!t) throw new NotFoundException('Template não encontrado');
    return t;
  }

  private async requireOfficialChannel(orgId: string, channelId: string) {
    // ChannelsService.findOne(id, organizationId) valida o org e lança
    // NotFound/Forbidden quando o canal não pertence à organização.
    const channel = await this.channels.findOne(channelId, orgId);
    if (!channel || channel.type !== 'WHATSAPP_OFFICIAL') {
      throw new BadRequestException('Canal precisa ser WhatsApp Oficial');
    }
    if (!(channel.config as any)?.businessAccountId) {
      throw new BadRequestException('Canal sem businessAccountId (WABA)');
    }
    return channel;
  }
}
