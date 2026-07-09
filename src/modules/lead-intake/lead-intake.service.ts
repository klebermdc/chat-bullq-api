import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ConversationSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizePhone } from '../../common/utils/phone.util';
import { CreateLeadIntakeDto } from './dto/create-lead-intake.dto';

@Injectable()
export class LeadIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(organizationId: string, secret: string | undefined, dto: CreateLeadIntakeDto) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, leadIntakeSecret: true },
    });
    if (!org || !org.leadIntakeSecret || org.leadIntakeSecret !== secret) {
      throw new UnauthorizedException('Secret inválido');
    }

    let phoneNormalized: string;
    try {
      phoneNormalized = normalizePhone(dto.phone);
    } catch {
      throw new BadRequestException('Telefone inválido');
    }

    return this.prisma.leadIntake.create({
      data: {
        organizationId,
        phoneNormalized,
        name: dto.name ?? null,
        source: ConversationSource.SITE_FORM,
        sourceDetail: {
          page: dto.page ?? null,
          formName: dto.formName ?? null,
          utmSource: dto.utmSource ?? null,
          utmMedium: dto.utmMedium ?? null,
          utmCampaign: dto.utmCampaign ?? null,
        },
      },
      select: { id: true },
    });
  }

  async rotateSecret(organizationId: string): Promise<{ secret: string }> {
    const secret = randomBytes(24).toString('hex');
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { leadIntakeSecret: secret },
    });
    return { secret };
  }

  async getConfig(organizationId: string): Promise<{ configured: boolean }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { leadIntakeSecret: true },
    });
    return { configured: !!org?.leadIntakeSecret };
  }
}
