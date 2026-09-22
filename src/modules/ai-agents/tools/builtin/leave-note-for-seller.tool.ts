import { Injectable } from '@nestjs/common';
import { MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

const MAX_SUMMARY_LENGTH = 1000;

/**
 * Aline de plantão: deixa para o vendedor um recado com o que o cliente
 * precisa. Vira mensagem SYSTEM na conversa: só a equipe vê, nunca vai para o
 * WhatsApp e não dispara a IA. Só é oferecida no modo plantão.
 */
@Injectable()
export class LeaveNoteForSellerTool implements AiTool {
  readonly name = 'leaveNoteForSeller';
  readonly description =
    'Deixa um recado interno para o vendedor da conversa, que está fora do horário. ' +
    'Resuma de forma objetiva o que o cliente quer e os dados que ele passou. O cliente não vê.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: {
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_SUMMARY_LENGTH,
        description: 'Resumo para o vendedor: o que o cliente precisa, datas, quantidades, urgência.',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const summary = String(input.summary ?? '').trim().slice(0, MAX_SUMMARY_LENGTH);
    if (!summary) {
      return { output: { ok: false, error: 'O recado está vazio.' } };
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: ctx.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: new Date(),
        content: { text: `📋 Recado da Aline (plantão): ${summary}`, onCallNote: true },
        metadata: { aiAgentId: ctx.agentId, runId: ctx.runId },
      },
    });

    this.realtime.emitToChannel(ctx.channelId, 'message:new', {
      message,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
    });
    this.realtime.emitToConversation(ctx.conversationId, 'message:new', { message });

    return { output: { ok: true } };
  }
}
