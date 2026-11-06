import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { SendCheckIds, SendCheckKind, SendCheckVerdict } from './send-check.types';

/** Teto da frase gravada: é só o trecho da IA para revisão, não a conversa. */
const MAX_SENTENCE_LENGTH = 1000;

export interface SendCheckRow extends SendCheckIds {
  check: SendCheckKind;
  verdict: SendCheckVerdict;
  /** Texto da própria IA (nunca dado do cliente). */
  sentence?: string | null;
  scores?: Record<string, unknown> | null;
}

/**
 * Grava uma linha em `ai_send_checks`. NUNCA lança: o registro das travas não
 * pode atrasar nem quebrar o envio ao cliente.
 */
@Injectable()
export class SendCheckRecorder {
  private readonly logger = new Logger(SendCheckRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(row: SendCheckRow): Promise<void> {
    try {
      await this.prisma.aiSendCheck.create({
        data: {
          organizationId: row.organizationId,
          conversationId: row.conversationId,
          runId: row.runId,
          agentId: row.agentId,
          check: row.check,
          verdict: row.verdict,
          sentence: row.sentence ? row.sentence.slice(0, MAX_SENTENCE_LENGTH) : null,
          scores: (row.scores ?? Prisma.DbNull) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[send-check] falha ao gravar check=${row.check} verdict=${row.verdict} run=${row.runId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
