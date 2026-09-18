import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { QuickRepliesRepository } from './quick-replies.repository';
import { CreateQuickReplyDto } from './dto/create-quick-reply.dto';
import { UpdateQuickReplyDto } from './dto/update-quick-reply.dto';

const SHORTCUT_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * Atalho como o atendente digita depois da barra no campo de mensagem
 * ("/pix"). Guardado sem a barra, minúsculo, só letras/números/-/_.
 */
export function normalizeShortcut(raw: string): string {
  const shortcut = (raw ?? '').trim().replace(/^\/+/, '').toLowerCase();
  if (!SHORTCUT_PATTERN.test(shortcut)) {
    throw new BadRequestException(
      'Atalho inválido: use até 32 letras sem acento, números, "-" ou "_" (ex.: pix, boas-vindas).',
    );
  }
  return shortcut;
}

@Injectable()
export class QuickRepliesService {
  constructor(private readonly repository: QuickRepliesRepository) {}

  async create(orgId: string, dto: CreateQuickReplyDto) {
    const shortcut = normalizeShortcut(dto.shortcut);
    const existing = await this.repository.findByShortcut(orgId, shortcut);
    if (existing) {
      throw new ConflictException(`O atalho /${shortcut} já existe`);
    }
    return this.repository.create({
      shortcut,
      title: dto.title,
      content: dto.content,
      organization: { connect: { id: orgId } },
    });
  }

  async findAll(orgId: string) {
    return this.repository.findByOrg(orgId);
  }

  async findOne(id: string, orgId: string) {
    const row = await this.repository.findById(id);
    if (!row || row.organizationId !== orgId) {
      throw new NotFoundException('Quick reply not found');
    }
    return row;
  }

  async update(id: string, orgId: string, dto: UpdateQuickReplyDto) {
    await this.findOne(id, orgId);
    const shortcut = dto.shortcut !== undefined ? normalizeShortcut(dto.shortcut) : undefined;
    if (shortcut !== undefined) {
      const clash = await this.repository.findByShortcut(orgId, shortcut);
      if (clash && clash.id !== id) {
        throw new ConflictException(`O atalho /${shortcut} já existe`);
      }
    }
    return this.repository.update(id, {
      ...(shortcut !== undefined && { shortcut }),
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.content !== undefined && { content: dto.content }),
    });
  }

  async remove(id: string, orgId: string) {
    const row = await this.findOne(id, orgId);
    return this.repository.softDelete(id, row.shortcut);
  }
}
