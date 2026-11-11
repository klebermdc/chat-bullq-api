import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { scopedUserWhere } from '../conversations/conversation-scope';
import { findContactIdsBySearch } from './contact-search';

const CONTACT_LIST_INCLUDE = {
  channels: { include: { channel: { select: { id: true, type: true, name: true } } } },
  tags: { include: { tag: true } },
  _count: { select: { conversations: true } },
} satisfies Prisma.ContactInclude;

@Injectable()
export class ContactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOrg(
    organizationId: string,
    search: string | undefined,
    skip: number,
    take: number,
  ) {
    if (search?.trim()) return this.searchByOrg(organizationId, search, skip, take);

    const where: Prisma.ContactWhereInput = { organizationId, deletedAt: null };
    const [contacts, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        include: CONTACT_LIST_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return { contacts, total };
  }

  /**
   * Busca com nome sem acento e por palavra, telefone em qualquer máscara
   * (com/sem 55 e 9) e e-mail. A ordem vem da busca (mais recente primeiro).
   */
  private async searchByOrg(organizationId: string, search: string, skip: number, take: number) {
    const { ids, total } = await findContactIdsBySearch(this.prisma, organizationId, search, {
      take,
      skip,
    });
    if (ids.length === 0) return { contacts: [], total };
    const rows = await this.prisma.contact.findMany({
      where: { id: { in: ids } },
      include: CONTACT_LIST_INCLUDE,
    });
    const byId = new Map(rows.map((c) => [c.id, c]));
    const contacts = ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
    return { contacts, total };
  }

  /**
   * `scopedUserId`: quando presente (AGENT), filtra a relação `conversations`
   * incluída pras que estão atribuídas a ele — sem isso, `GET /contacts/:id`
   * (rota `contacts.view = ALL`, usada pelo Inbox) vazava as últimas 10
   * conversas do contato COM o corpo da última mensagem de cada uma, mesmo
   * as de colegas. `undefined` = sem filtro (OWNER/ADMIN).
   */
  async findById(id: string, scopedUserId?: string) {
    return this.prisma.contact.findFirst({
      where: { id, deletedAt: null },
      include: {
        channels: { include: { channel: { select: { id: true, type: true, name: true } } } },
        tags: { include: { tag: true } },
        conversations: {
          where: scopedUserId ? scopedUserWhere(scopedUserId) : undefined,
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            channel: { select: { type: true, name: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, type: true, createdAt: true } },
          },
        },
      },
    });
  }

  async update(id: string, data: Prisma.ContactUpdateInput) {
    return this.prisma.contact.update({ where: { id }, data });
  }

  async softDelete(id: string) {
    return this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async findByChannelExternal(channelId: string, externalId: string) {
    return this.prisma.contactChannel.findUnique({
      where: { uq_contact_channel_external: { channelId, externalId } },
      include: { contact: true },
    });
  }

  async findFirstByOrgPhone(organizationId: string, phone: string) {
    return this.prisma.contact.findFirst({
      where: { organizationId, phone, deletedAt: null },
    });
  }

  async createWithChannel(
    organizationId: string,
    input: { name?: string; phone: string; email?: string; notes?: string; channelId?: string },
  ) {
    return this.prisma.contact.create({
      data: {
        organizationId,
        name: input.name ?? null,
        phone: input.phone,
        email: input.email ?? null,
        notes: input.notes ?? null,
        channels: input.channelId
          ? { create: { channelId: input.channelId, externalId: input.phone, profileName: input.name ?? null } }
          : undefined,
      },
      include: {
        channels: { include: { channel: { select: { id: true, type: true, name: true } } } },
        tags: { include: { tag: true } },
        _count: { select: { conversations: true } },
      },
    });
  }

  async create(data: { organizationId: string; name?: string; phone: string; email?: string; notes?: string }) {
    return this.prisma.contact.create({ data });
  }
}
