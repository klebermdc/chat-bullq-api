import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { MessengerHttpClient } from './messenger.http-client';

@Injectable()
export class MessengerContactEnricherService {
  private readonly logger = new Logger(MessengerContactEnricherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpClient: MessengerHttpClient,
  ) {}

  /**
   * Busca nome e foto do PSID no Graph e preenche o contato.
   * Nunca lanca: enriquecimento e enfeite, e falha aqui nao pode derrubar a
   * entrega da mensagem.
   */
  async enrich(channel: Channel, externalContactId: string): Promise<void> {
    try {
      const profile = await this.httpClient.getUserProfile(channel, externalContactId);
      if (!profile) return;

      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
      const avatarUrl = profile.profile_pic;
      if (!name && !avatarUrl) return;

      const contactChannel = await this.prisma.contactChannel.findUnique({
        where: {
          uq_contact_channel_external: {
            channelId: channel.id,
            externalId: externalContactId,
          },
        },
        include: { contact: true },
      });
      if (!contactChannel) return;

      const ccUpdates: Record<string, unknown> = {};
      if (name && name !== contactChannel.profileName) ccUpdates.profileName = name;
      if (avatarUrl && avatarUrl !== contactChannel.profileAvatarUrl) {
        ccUpdates.profileAvatarUrl = avatarUrl;
      }
      if (Object.keys(ccUpdates).length > 0) {
        await this.prisma.contactChannel.update({
          where: { id: contactChannel.id },
          data: ccUpdates,
        });
      }

      const contactUpdates: Record<string, unknown> = {};
      if (name && !contactChannel.contact.name) contactUpdates.name = name;
      if (avatarUrl && !contactChannel.contact.avatarUrl) contactUpdates.avatarUrl = avatarUrl;
      if (Object.keys(contactUpdates).length > 0) {
        await this.prisma.contact.update({
          where: { id: contactChannel.contactId },
          data: contactUpdates,
        });
      }

      this.logger.log(
        `Contato do Messenger enriquecido: ${externalContactId} → ${name || '(sem nome)'}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Enriquecimento do contato ${externalContactId} falhou: ${message}`,
      );
    }
  }
}
