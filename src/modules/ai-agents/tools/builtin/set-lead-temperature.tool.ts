import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

/**
 * Registra o "termômetro" do lead desta conversa numa escala 1-3. Usado pelo
 * SDR ao encerrar a qualificação, antes de transferir pro humano. Grava em
 * Conversation.temperature (a conversa sempre existe; o card do pipeline lê
 * isso pela relação e mostra um selo colorido).
 */
@Injectable()
export class SetLeadTemperatureTool implements AiTool {
  private readonly logger = new Logger(SetLeadTemperatureTool.name);

  readonly name = 'setLeadTemperature';
  readonly description =
    'Registra a temperatura (termômetro) do lead desta conversa: 1 = frio (só curiosidade, sem datas), 2 = morno (interesse real, ainda pesquisando), 3 = quente (datas definidas, alta intenção). Use UMA vez, ao encerrar sua qualificação, antes de transferir pro humano.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['temperature'],
    properties: {
      temperature: {
        type: 'integer',
        enum: [1, 2, 3],
        description: '1 = frio, 2 = morno, 3 = quente.',
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const t = Number(input.temperature);
    if (!Number.isInteger(t) || t < 1 || t > 3) {
      return {
        output: { ok: false, error: 'temperature deve ser 1, 2 ou 3' },
      };
    }
    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { temperature: t },
    });
    this.logger.log(`lead temperature=${t} (conv=${ctx.conversationId})`);
    return { output: { ok: true, temperature: t } };
  }
}
