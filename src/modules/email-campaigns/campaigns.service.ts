import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EmailCampaignStatus } from '@prisma/client';
import { parseEmailContent } from '../email-core/email-blocks.types';
import { CampaignsRepository } from './campaigns.repository';
import { UpsertCampaignDto } from './dto/upsert-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(private readonly repo: CampaignsRepository) {}

  /**
   * Valida no save, não no envio. Conteúdo inválido tem que barrar antes de
   * virar mil linhas em `email_messages`.
   */
  private validate(dto: UpsertCampaignDto) {
    if (!dto.subject?.trim()) throw new BadRequestException('assunto é obrigatório');
    try {
      parseEmailContent(dto.content);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  async findOne(id: string, organizationId: string) {
    const campaign = await this.repo.findById(id, organizationId);
    if (!campaign) throw new NotFoundException('campanha não encontrada');
    return campaign;
  }

  // `async` é necessário mesmo sem `await`: assim uma validação que lança
  // synchronously vira rejeição de Promise (não um throw síncrono), que é o
  // contrato que os chamadores (e os testes) esperam de um método `create`.
  async create(organizationId: string, userId: string, dto: UpsertCampaignDto) {
    this.validate(dto);
    return this.repo.create({
      organizationId,
      createdById: userId,
      name: dto.name.trim(),
      subject: dto.subject.trim(),
      preheader: dto.preheader?.trim() || null,
      fromName: dto.fromName?.trim() || null,
      content: dto.content as any,
      audienceFilter: (dto.audienceFilter ?? {}) as any,
      status: EmailCampaignStatus.DRAFT,
    });
  }

  async update(id: string, organizationId: string, dto: UpsertCampaignDto) {
    const campaign = await this.findOne(id, organizationId);
    if (campaign.status !== EmailCampaignStatus.DRAFT) {
      throw new BadRequestException('só é possível editar campanha em rascunho');
    }
    this.validate(dto);
    return this.repo.update(id, {
      name: dto.name.trim(),
      subject: dto.subject.trim(),
      preheader: dto.preheader?.trim() || null,
      fromName: dto.fromName?.trim() || null,
      content: dto.content as any,
      audienceFilter: (dto.audienceFilter ?? {}) as any,
    });
  }

  list(organizationId: string, page = 1, limit = 20) {
    return this.repo.list(organizationId, (page - 1) * limit, limit);
  }
}
