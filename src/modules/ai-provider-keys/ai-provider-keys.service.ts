import { Injectable, NotFoundException } from '@nestjs/common';
import { AiCapability, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CreateAiProviderKeyDto } from './dto/create-ai-provider-key.dto';
import { UpdateAiProviderKeyDto } from './dto/update-ai-provider-key.dto';

const PUBLIC_SELECT = {
  id: true,
  name: true,
  provider: true,
  keyPreview: true,
  capabilities: true,
  baseUrl: true,
  model: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiProviderKeySelect;

@Injectable()
export class AiProviderKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async findAll(organizationId: string) {
    return this.prisma.aiProviderKey.findMany({
      where: { organizationId },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, dto: CreateAiProviderKeyDto) {
    const caps = dto.capabilities ?? [];
    const created = await this.prisma.aiProviderKey.create({
      data: {
        organizationId,
        name: dto.name,
        provider: dto.provider,
        encryptedKey: this.crypto.encrypt(dto.key),
        keyPreview: this.crypto.preview(dto.key),
        capabilities: caps,
        baseUrl: dto.baseUrl ?? null,
        model: dto.model ?? null,
      },
      select: PUBLIC_SELECT,
    });
    await this.enforceSingleOwner(organizationId, created.id, caps);
    return this.findOne(organizationId, created.id);
  }

  async update(organizationId: string, id: string, dto: UpdateAiProviderKeyDto) {
    await this.findOne(organizationId, id);
    const data: Prisma.AiProviderKeyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.capabilities !== undefined) data.capabilities = dto.capabilities;
    if (dto.key) {
      data.encryptedKey = this.crypto.encrypt(dto.key);
      data.keyPreview = this.crypto.preview(dto.key);
    }
    await this.prisma.aiProviderKey.update({ where: { id }, data });
    if (dto.capabilities !== undefined) {
      await this.enforceSingleOwner(organizationId, id, dto.capabilities);
    }
    return this.findOne(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    await this.prisma.aiProviderKey.delete({ where: { id } });
    return { message: 'Chave removida' };
  }

  private async findOne(organizationId: string, id: string) {
    const row = await this.prisma.aiProviderKey.findFirst({
      where: { id, organizationId },
      select: PUBLIC_SELECT,
    });
    if (!row) throw new NotFoundException('Chave não encontrada');
    return row;
  }

  /** Remove as capabilities recém-atribuídas de qualquer OUTRA chave da org. */
  private async enforceSingleOwner(
    organizationId: string,
    keepId: string,
    caps: AiCapability[],
  ) {
    if (!caps.length) return;
    const others = await this.prisma.aiProviderKey.findMany({
      where: { organizationId, id: { not: keepId } },
      select: { id: true, capabilities: true },
    });
    for (const o of others) {
      const filtered = o.capabilities.filter((c) => !caps.includes(c));
      if (filtered.length !== o.capabilities.length) {
        await this.prisma.aiProviderKey.update({
          where: { id: o.id },
          data: { capabilities: filtered },
        });
      }
    }
  }
}
