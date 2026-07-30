import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ContactSync } from './ports/types';

/**
 * Espelha a agenda do cliente vinda do app do WhatsApp Business
 * (webhook `smb_app_state_sync`). Só existe em canal de coexistência.
 *
 * O nome importa mais do que parece: sem ele o inbox mostra número cru, e
 * quem atende não reconhece de quem é a conversa.
 */
@Injectable()
export class CoexistenceContactsService {
  private readonly logger = new Logger(CoexistenceContactsService.name);

  private static readonly REMOVE_ACTIONS = new Set(['remove', 'delete', 'deleted']);

  constructor(private readonly prisma: PrismaService) {}

  async handle(channel: Channel, sync: ContactSync): Promise<void> {
    const name = sync.fullName || sync.firstName;

    const link = await this.prisma.contactChannel.findUnique({
      where: {
        uq_contact_channel_external: {
          channelId: channel.id,
          externalId: sync.phone,
        },
      },
      select: { contactId: true },
    });

    if (CoexistenceContactsService.REMOVE_ACTIONS.has(sync.action)) {
      // NÃO apaga. O contato tem conversa, card de lead e histórico pendurados;
      // remover da agenda do celular não significa que a relação comercial
      // deixou de existir. Só registra a origem da remoção.
      if (!link) return;
      // MERGE, nunca substituir: o `metadata` guarda outras coisas (origem do
      // lead, ctwa, marcações). Trocar o objeto inteiro apagaria tudo.
      const current = await this.prisma.contact.findUnique({
        where: { id: link.contactId },
        select: { metadata: true },
      });
      await this.prisma.contact.update({
        where: { id: link.contactId },
        data: {
          metadata: {
            ...((current?.metadata as Record<string, any>) ?? {}),
            smbRemovedAt: new Date().toISOString(),
            smbRemovedFromChannelId: channel.id,
          },
        },
      });
      this.logger.log(
        `Coexistência: contato ${sync.phone} removido da agenda do app — marcado, NÃO apagado (canal ${channel.id}).`,
      );
      return;
    }

    if (link) {
      if (!name) return; // nada a atualizar
      await this.prisma.contact.update({
        where: { id: link.contactId },
        data: { name },
      });
      await this.prisma.contactChannel.update({
        where: {
          uq_contact_channel_external: {
            channelId: channel.id,
            externalId: sync.phone,
          },
        },
        data: { profileName: name },
      });
      return;
    }

    // Contato novo: nasce da agenda, antes de qualquer conversa existir.
    const contact = await this.prisma.contact.create({
      data: {
        organizationId: channel.organizationId,
        name: name ?? null,
        phone: sync.phone,
        metadata: { source: 'smb_app_state_sync' },
      },
    });
    await this.prisma.contactChannel.create({
      data: {
        contactId: contact.id,
        channelId: channel.id,
        externalId: sync.phone,
        profileName: name ?? null,
      },
    });
    this.logger.log(
      `Coexistência: contato ${sync.phone} criado a partir da agenda do app (canal ${channel.id}).`,
    );
  }
}
