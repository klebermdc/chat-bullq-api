import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TranscriptionService } from '../messaging/messages/transcription.service';
import { CallInsightService } from './call-insight.service';
import { RecordingDownloader } from './recording-downloader';
import { CALL_INSIGHT_QUEUE } from './call-insight.constants';

export interface CallInsightJobData {
  callId: string;
}

/**
 * Processa o resumo de uma ligação: baixa a gravação (retry até estar pronta),
 * transcreve (Whisper) e resume (LLM), gravando no Call e emitindo em tempo real.
 * A decisão de re-tentar (gravação assíncrona) fica no BullMQ via `attempts`+backoff.
 */
@Processor(CALL_INSIGHT_QUEUE, { concurrency: 2 })
export class CallInsightProcessor extends WorkerHost {
  private readonly logger = new Logger(CallInsightProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly downloader: RecordingDownloader,
    private readonly transcription: TranscriptionService,
    private readonly insight: CallInsightService,
    private readonly realtime: RealtimeGateway,
  ) {
    super();
  }

  async process(job: Job<CallInsightJobData>): Promise<void> {
    const { callId } = job.data;
    if (!callId) return;

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call) return;

    // Não-atendida / sem gravação → nada a resumir.
    if (!call.answered || !call.recordingUrl) {
      await this.prisma.call.update({
        where: { id: callId },
        data: { insightState: 'SKIPPED' },
      });
      return;
    }
    // Idempotência: já processado.
    if (call.insightState === 'READY') return;

    try {
      // 1. baixa (lança se ainda não pronta → BullMQ re-tenta)
      const audio = await this.downloader.download(call.recordingUrl);
      // 2. transcreve
      const t = await this.transcription.transcribeBuffer(
        call.organizationId,
        audio.buffer,
        audio.mimeType,
        `call-${callId}.mp3`,
      );
      const transcript = t.text;
      // 3. resume (se falhar, mantém a transcrição e segue — insight fica null)
      let insight: unknown = null;
      try {
        insight = await this.insight.summarize(call.organizationId, transcript);
      } catch (e) {
        this.logger.warn(`Resumo da ligação ${callId} falhou (transcrição salva): ${(e as Error).message}`);
      }
      // 4. grava
      await this.prisma.call.update({
        where: { id: callId },
        data: { transcript, insight: insight as any, insightState: 'READY' },
      });
      // 5. realtime + atualiza o card na timeline
      this.realtime.emitToConversation(call.conversationId, 'call:insight', {
        callId,
        insightState: 'READY',
        insight,
        hasTranscript: !!transcript,
      });
      if (call.messageId) {
        const content = {
          kind: 'call',
          callId,
          status: call.status,
          answered: call.answered,
          durationSec: call.durationSec,
          recordingUrl: call.recordingUrl,
          insightState: 'READY',
          insight,
        };
        await this.prisma.message.update({
          where: { id: call.messageId },
          data: { content: content as any },
        });
        this.realtime.emitToConversation(call.conversationId, 'message:update', {
          messageId: call.messageId,
          content,
        });
      }
    } catch (err) {
      const attempt = (job.attemptsMade ?? 0) + 1;
      const maxAttempts = job.opts?.attempts ?? 1;
      if (attempt >= maxAttempts) {
        // Esgotou as tentativas (gravação nunca ficou pronta / erro persistente).
        // Marca FAILED e NÃO re-lança — não trava a fila.
        await this.prisma.call.update({
          where: { id: callId },
          data: { insightState: 'FAILED' },
        });
        this.logger.error(
          `Call insight ${callId} FAILED após ${attempt} tentativas: ${(err as Error).message}`,
        );
        return;
      }
      // Ainda há tentativas — re-lança pra o BullMQ re-agendar com backoff.
      throw err;
    }
  }
}
