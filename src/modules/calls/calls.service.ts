import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SonaxSettingsService } from './sonax-settings.service';
import { SonaxClient } from './sonax-client';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { normalizeBrazilNumber } from './phone.util';

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SonaxSettingsService,
    private readonly sonax: SonaxClient,
    private readonly realtime: RealtimeGateway,
  ) {}

  async initiateCall(conversationId: string, userId: string, organizationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { contact: true },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');

    const rawPhone = conversation.contact?.phone;
    if (!rawPhone) throw new BadRequestException('Conversa sem telefone para discar');
    const numero = normalizeBrazilNumber(rawPhone);

    const dial = await this.settings.getDecryptedForDial(organizationId);
    if (!dial) throw new BadRequestException('Sonax não configurada ou desabilitada nesta organização');

    const member = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!member?.sonaxRamal) {
      throw new BadRequestException('Configure seu ramal Sonax na tela de Membros antes de ligar');
    }

    const call = await this.prisma.call.create({
      data: { organizationId, conversationId, agentId: userId, ramal: member.sonaxRamal, numero, status: 'DIALING' },
    });
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        type: 'SYSTEM',
        senderId: userId,
        status: 'SENT',
        content: { kind: 'call', callId: call.id, status: 'DIALING' },
      },
    });
    await this.prisma.call.update({ where: { id: call.id }, data: { messageId: message.id } });
    this.realtime.emitToConversation(conversationId, 'message:new', { message });

    try {
      await this.sonax.click2call({
        baseUrl: dial.click2callBaseUrl,
        numero,
        ramal: member.sonaxRamal,
        token: dial.token,
        var1: call.id,
      });
    } catch (err) {
      await this.prisma.call.update({ where: { id: call.id }, data: { status: 'FAILED', endedAt: new Date() } });
      const failedContent = { kind: 'call', callId: call.id, status: 'FAILED' };
      await this.prisma.message.update({ where: { id: message.id }, data: { content: failedContent } });
      this.realtime.emitToConversation(conversationId, 'message:update', { messageId: message.id, content: failedContent });
      throw new BadGatewayException('Falha ao iniciar a ligação na Sonax');
    }

    return { callId: call.id, status: 'DIALING' as const };
  }
}
