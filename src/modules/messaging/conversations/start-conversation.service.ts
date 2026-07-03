import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ChannelType, MessageContentType, MessageDirection, MessageStatus, OrgRole, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { ConversationResolverService } from '../pipeline/conversation-resolver.service';
import { normalizePhone } from '../../../common/utils/phone.util';
import { StartConversationDto } from './dto/start-conversation.dto';

@Injectable()
export class StartConversationService {
  private readonly logger = new Logger(StartConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ConversationResolverService,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  private toExternalId(channelType: ChannelType, phone: string): string {
    return channelType === ChannelType.WHATSAPP_ZAPPFY ? `${phone}@s.whatsapp.net` : phone;
  }

  async start(
    organizationId: string,
    dto: StartConversationDto,
    creator?: { userOrganizationId: string; role: OrgRole },
  ): Promise<{ conversationId: string }> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: dto.channelId, organizationId, deletedAt: null },
    });
    if (!channel) throw new BadRequestException('Canal não encontrado.');
    if (channel.type === ChannelType.WHATSAPP_OFFICIAL) {
      throw new BadRequestException('Iniciar conversa no canal oficial exige template (HSM) — disponível em breve.');
    }
    if (!dto.phone && !dto.contactId) {
      throw new BadRequestException('Informe um telefone ou um contato.');
    }

    let phone: string;
    if (dto.contactId) {
      const contact = await this.prisma.contact.findFirst({
        where: { id: dto.contactId, organizationId, deletedAt: null },
      });
      if (!contact?.phone) throw new BadRequestException('Contato sem telefone válido.');
      phone = normalizePhone(contact.phone);
    } else {
      phone = normalizePhone(dto.phone as string);
    }

    const externalId = this.toExternalId(channel.type, phone);
    const contactId = await this.resolveContact(organizationId, channel.id, {
      phone, name: dto.name, externalId, preferContactId: dto.contactId,
    });

    const { conversationId } = await this.resolver.resolve(organizationId, channel.id, contactId);
    await this.enqueue(channel.id, conversationId, externalId, dto.message);
    return { conversationId };
  }

  private async resolveContact(
    organizationId: string,
    channelId: string,
    data: { phone: string; name?: string; externalId: string; preferContactId?: string },
  ): Promise<string> {
    const existingCC = await this.prisma.contactChannel.findUnique({
      where: { uq_contact_channel_external: { channelId, externalId: data.externalId } },
    });
    if (existingCC) return existingCC.contactId;

    if (data.preferContactId) {
      await this.prisma.contactChannel.create({
        data: { contactId: data.preferContactId, channelId, externalId: data.externalId, profileName: data.name },
      });
      return data.preferContactId;
    }

    const existingContact = await this.prisma.contact.findFirst({
      where: { organizationId, phone: data.phone, deletedAt: null },
    });
    if (existingContact) {
      await this.prisma.contactChannel.create({
        data: { contactId: existingContact.id, channelId, externalId: data.externalId, profileName: data.name },
      });
      return existingContact.id;
    }

    const contact = await this.prisma.contact.create({
      data: {
        organizationId,
        name: data.name,
        phone: data.phone,
        channels: { create: { channelId, externalId: data.externalId, profileName: data.name } },
      },
    });
    this.logger.log(`Start-conversation: contato criado ${contact.id} (${data.phone})`);
    return contact.id;
  }

  private async enqueue(channelId: string, conversationId: string, externalId: string, text: string) {
    const type = MessageContentType.TEXT;
    const content: Prisma.InputJsonValue = { text };
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        type,
        content,
        status: MessageStatus.QUEUED,
        senderName: 'Atendimento',
        metadata: { source: 'start_conversation' },
      },
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
    await this.outboundQueue.add(
      'send-outbound',
      { messageId: message.id, channelId, contactExternalId: externalId, message: { type, content } },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: false },
    );
  }
}
