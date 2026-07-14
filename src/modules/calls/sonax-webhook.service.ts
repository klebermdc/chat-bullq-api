import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { mapSonaxStatus } from './sonax-status.util';

// estados terminais: se o Call já está num deles, o webhook é ignorado (idempotência).
const TERMINAL = new Set(['FINISHED', 'NO_ANSWER', 'BUSY', 'FAILED']);

export interface SonaxWebhookQuery {
  var_1?: string;
  status?: string;
  status_atend?: string;
  duracao?: string;
  url_gravacao?: string;
  [k: string]: any;
}

@Injectable()
export class SonaxWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async apply(secret: string, q: SonaxWebhookQuery): Promise<{ ok: true; skipped?: boolean }> {
    const settings = await this.prisma.sonaxSettings.findFirst({ where: { webhookSecret: secret } });
    if (!settings) throw new NotFoundException('secret inválido');

    const callId = q.var_1;
    if (!callId) return { ok: true, skipped: true };

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call || call.organizationId !== settings.organizationId) {
      throw new NotFoundException('call não encontrado para esta organização');
    }

    if (TERMINAL.has(call.status)) return { ok: true, skipped: true };

    const { status, answered } = mapSonaxStatus(q.status ?? '', q.status_atend);
    const durationSec = q.duracao ? parseInt(String(q.duracao), 10) : undefined;
    const recordingUrl = q.url_gravacao || undefined;
    const isTerminal = TERMINAL.has(status);

    await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        answered,
        ...(durationSec !== undefined && !Number.isNaN(durationSec) ? { durationSec } : {}),
        ...(recordingUrl ? { recordingUrl } : {}),
        ...(isTerminal ? { endedAt: new Date() } : {}),
        raw: q as any,
      },
    });

    const content = {
      kind: 'call',
      callId: call.id,
      status,
      answered,
      ...(durationSec !== undefined && !Number.isNaN(durationSec) ? { durationSec } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
    };
    if (call.messageId) {
      await this.prisma.message.update({ where: { id: call.messageId }, data: { content } });
      this.realtime.emitToConversation(call.conversationId, 'message:update', { messageId: call.messageId, content });
    }

    return { ok: true };
  }
}
