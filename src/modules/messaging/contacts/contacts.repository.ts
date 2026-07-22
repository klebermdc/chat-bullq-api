import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ContactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOrg(
    organizationId: string,
    search: string | undefined,
    skip: number,
    take: number,
  ) {
    const where: Prisma.ContactWhereInput = { organizationId, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [contacts, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        include: {
          channels: { include: { channel: { select: { id: true, type: true, name: true } } } },
          tags: { include: { tag: true } },
          _count: { select: { conversations: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.contact.count({ where }),
    ]);

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
          where: scopedUserId ? { assignedToId: scopedUserId } : undefined,
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
