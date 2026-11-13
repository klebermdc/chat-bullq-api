import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Detector de destinatário simulado (cliente oculto sem chip). Um contato é
 * simulado se algum MysteryShopperNumber dele tem isSimulated = true — removido
 * ou não: um número simulado nunca vai para a Meta.
 */
@Injectable()
export class SimulatedRecipients {
  constructor(private readonly prisma: PrismaService) {}

  async isSimulated(channelId: string, contactExternalId: string): Promise<boolean> {
    const link = await this.prisma.contactChannel.findUnique({
      where: { uq_contact_channel_external: { channelId, externalId: contactExternalId } },
      select: { contactId: true },
    });
    if (!link) return false;
    return this.isSimulatedContact(link.contactId);
  }

  async isSimulatedContact(contactId: string): Promise<boolean> {
    const row = await this.prisma.mysteryShopperNumber.findFirst({
      where: { contactId, isSimulated: true },
      select: { id: true },
    });
    return row !== null;
  }

  async isSimulatedConversation(conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true },
    });
    if (!conversation) return false;
    return this.isSimulatedContact(conversation.contactId);
  }
}
