import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
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

/** Quem está pedindo: decide o que ele enxerga. */
export interface QuickReplyViewer {
  userId: string;
  role: OrgRole | undefined;
}

function canSeeAll(viewer: QuickReplyViewer): boolean {
  return viewer.role === OrgRole.OWNER || viewer.role === OrgRole.ADMIN;
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
    const ownerUserId = dto.ownerUserId ?? null;
    if (ownerUserId) await this.assertMember(orgId, ownerUserId);
    return this.repository.create({
      shortcut,
      title: dto.title,
      content: dto.content,
      organization: { connect: { id: orgId } },
      ...(ownerUserId && { owner: { connect: { id: ownerUserId } } }),
    });
  }

  /** Dono/admin veem todas; atendente vê as da equipe e as próprias. */
  async findAll(orgId: string, viewer: QuickReplyViewer) {
    return this.repository.findVisible(orgId, canSeeAll(viewer) ? null : viewer.userId);
  }

  async findOneVisible(id: string, orgId: string, viewer: QuickReplyViewer) {
    const row = await this.findOne(id, orgId);
    const isHidden = !canSeeAll(viewer) && row.ownerUserId !== null && row.ownerUserId !== viewer.userId;
    if (isHidden) {
      throw new NotFoundException('Quick reply not found');
    }
    return row;
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
    if (dto.ownerUserId) await this.assertMember(orgId, dto.ownerUserId);
    return this.repository.update(id, {
      ...(shortcut !== undefined && { shortcut }),
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.content !== undefined && { content: dto.content }),
      ...(dto.ownerUserId !== undefined && {
        owner: dto.ownerUserId ? { connect: { id: dto.ownerUserId } } : { disconnect: true },
      }),
    });
  }

  private async assertMember(orgId: string, userId: string) {
    if (!(await this.repository.isMember(orgId, userId))) {
      throw new BadRequestException('O vendedor escolhido não faz parte desta organização.');
    }
  }

  async remove(id: string, orgId: string) {
    const row = await this.findOne(id, orgId);
    return this.repository.softDelete(id, row.shortcut);
  }
}
