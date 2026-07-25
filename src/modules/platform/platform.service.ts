import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PlatformRepository } from './platform.repository';
import { CreateOrganizationDto } from './dto/create-organization.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class PlatformService {
  constructor(private readonly repo: PlatformRepository) {}

  async createOrganization(dto: CreateOrganizationDto) {
    const slug = this.slugify(dto.companyName);

    if (await this.repo.findOrgBySlug(slug)) {
      throw new ConflictException(`Já existe uma empresa com o identificador "${slug}"`);
    }
    if (await this.repo.findUserByEmail(dto.ownerEmail)) {
      throw new ConflictException('Já existe um usuário com esse e-mail');
    }

    const ownerPasswordHash = await bcrypt.hash(dto.ownerPassword, BCRYPT_ROUNDS);
    const { organization, user } = await this.repo.createOrgWithOwner({
      companyName: dto.companyName,
      slug,
      plan: dto.plan ?? 'free',
      ownerName: dto.ownerName,
      ownerEmail: dto.ownerEmail,
      ownerPasswordHash,
    });

    const { password: _drop, ...owner } = user as any;
    return { organization, owner };
  }

  listOrganizations() {
    return this.repo.listOrganizations();
  }

  async setSuspended(id: string, suspended: boolean) {
    const org = await this.repo.findOrgById(id);
    if (!org) throw new NotFoundException('Empresa não encontrada');
    return this.repo.setSuspended(id, suspended ? new Date() : null);
  }

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    return `${base}-${Date.now().toString(36)}`;
  }
}
