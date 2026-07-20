import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';

export type GreetingSource = 'HANDOFF_APPROVE' | 'TRANSFER' | 'MANUAL_ASSIGN';

@Injectable()
export class AttendantGreetingService {
  private readonly logger = new Logger(AttendantGreetingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messages: MessagesService,
    private readonly settings: AttendantGreetingSettingsService,
  ) {}

  /**
   * Envia a saudação de apresentação do atendente ao cliente. Best-effort:
   * qualquer falha (janela 24h fechada, canal off, settings) é logada e
   * engolida — nunca propaga para o gatilho (atribuição/transferência).
   */
  async greet(params: {
    conversationId: string;
    attendantUserId: string;
    source: GreetingSource;
  }): Promise<void> {
    const { conversationId, attendantUserId, source } = params;
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, organizationId: true, isGroup: true },
      });
      if (!conversation || conversation.isGroup) return;

      const settings = await this.settings.get(conversation.organizationId);
      if (!settings.enabled) return;

      const user = await this.prisma.user.findUnique({
        where: { id: attendantUserId },
        select: { name: true },
      });
      const firstName =
        (user?.name ?? '').trim().split(/\s+/)[0] || 'atendente';
      const text = settings.template.split('{atendente}').join(firstName);

      await this.messages.send(
        { conversationId, type: 'TEXT', content: { text } },
        attendantUserId,
        conversation.organizationId,
        'ALL',
      );

      this.logger.log({
        msg: 'attendant_greeting_sent',
        conversationId,
        attendantUserId,
        source,
      });
    } catch (err: any) {
      this.logger.warn(
        `attendant greeting falhou (conv=${conversationId}, source=${source}): ${err?.message ?? err}`,
      );
    }
  }
}
