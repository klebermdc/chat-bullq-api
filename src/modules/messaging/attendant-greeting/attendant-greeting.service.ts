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
        select: {
          id: true,
          organizationId: true,
          isGroup: true,
          metadata: true,
        },
      });
      if (!conversation || conversation.isGroup) return;

      // Anti-duplicidade: o mesmo atendente só se apresenta UMA vez por
      // conversa. Sem isso, os gatilhos se somam no dia a dia — aprovar o
      // handoff e logo depois clicar "Assumir" mandaria a mesma saudação duas
      // vezes pro cliente. Outro atendente assumindo depois saúda normalmente.
      const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
      const lastGreeting = metadata.attendantGreeting as
        | { userId?: string }
        | undefined;
      if (lastGreeting?.userId === attendantUserId) {
        this.logger.log({
          msg: 'attendant_greeting_skipped_duplicate',
          conversationId,
          attendantUserId,
          source,
        });
        return;
      }

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
        undefined,
        { system: true },
      );

      // Marca quem já se apresentou (alimenta a guarda acima). Mesclado pra
      // não pisar em outras chaves do metadata da conversa.
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          metadata: {
            ...metadata,
            attendantGreeting: {
              userId: attendantUserId,
              at: new Date().toISOString(),
              source,
            },
          },
        },
      });

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
