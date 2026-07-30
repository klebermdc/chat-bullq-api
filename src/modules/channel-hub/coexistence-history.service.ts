import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  ChannelSyncStatus,
  MessageDirection,
  NotificationType,
  OrgRole,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HistoryImportService } from '../messaging/pipeline/history-import.service';
import { HistoryChunk } from './ports/types';

/**
 * Ingestão do histórico de coexistência (webhook `history`).
 *
 * A Meta empurra até 180 dias de conversa em pedaços, logo após o onboarding,
 * e dá **24 horas** pra concluir — estourando, o cliente precisa ser
 * desconectado e refazer o fluxo inteiro.
 *
 * REUSA o `HistoryImportService`, construído para o sync do Zappfy. Ele grava
 * direto via `createMany`, sem passar pela fila inbound: nada de IA, cadência,
 * card de lead, notificação ou webhook de saída. Isso é o requisito central —
 * sem esse caminho silencioso, importar 180 dias dispararia automação
 * retroativa em massa (a Aline respondendo quem já comprou, cadência sobre
 * conversa morta, cards pulando de etapa).
 *
 * A diferença em relação ao Zappfy: lá é PULL (chamamos a API deles), aqui é
 * PUSH. O `ChannelSyncJob` vira placar e máquina de estado, não executor.
 */
@Injectable()
export class CoexistenceHistoryService {
  private readonly logger = new Logger(CoexistenceHistoryService.name);

  /** 2593109 = o cliente desligou o compartilhamento de histórico no app. */
  private static readonly ERR_SYNC_DISABLED = 2593109;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly historyImport: HistoryImportService,
  ) {}

  async handleChunk(channel: Channel, chunk: HistoryChunk): Promise<void> {
    if (chunk.error) {
      await this.handleError(channel, chunk.error);
      return;
    }

    const job = await this.getOrCreateJob(channel);
    let conversations = 0;
    let messages = 0;

    for (const thread of chunk.threads) {
      try {
        const { conversationId } = await this.historyImport.importConversation(
          channel,
          {
            externalConversationId: thread.contactPhone,
            externalContactId: thread.contactPhone,
            contactPhone: thread.contactPhone,
          },
        );
        conversations += 1;

        const result = await this.historyImport.importMessages(
          channel,
          conversationId,
          thread.messages.map((m) => ({
            externalMessageId: m.externalId,
            externalConversationId: thread.contactPhone,
            externalContactId: thread.contactPhone,
            direction: m.fromBusiness
              ? MessageDirection.OUTBOUND
              : MessageDirection.INBOUND,
            timestamp: m.timestamp ?? new Date(),
            type: m.type,
            content: m.content,
          })),
        );
        messages += result.imported;
      } catch (err: any) {
        // Uma thread ruim não pode abortar o pedaço inteiro — o relógio de 24h
        // está correndo e o resto do histórico ainda vale.
        this.logger.error(
          `Falha ao importar thread ${thread.contactPhone} do canal ${channel.id}: ${err?.message}`,
        );
      }
    }

    const done = (chunk.progress ?? 0) >= 100;
    await this.prisma.channelSyncJob.update({
      where: { id: job.id },
      data: {
        status: done ? ChannelSyncStatus.COMPLETED : ChannelSyncStatus.RUNNING,
        conversationsImported: { increment: conversations },
        messagesImported: { increment: messages },
        finishedAt: done ? new Date() : null,
        lastCursor: chunk.phase
          ? `${chunk.phase}:${chunk.chunkOrder ?? 0}`
          : undefined,
      },
    });

    this.logger.log(
      `Coexistência: histórico do canal ${channel.id} — fase ${chunk.phase ?? '?'} ` +
        `pedaço ${chunk.chunkOrder ?? '?'}, ${conversations} conversa(s) e ${messages} msg(s), ` +
        `progresso ${chunk.progress ?? '?'}%${done ? ' — CONCLUÍDO' : ''}`,
    );

    if (done) {
      await this.notify(
        channel,
        `Histórico importado no canal "${channel.name}"`,
        'A sincronização do histórico do WhatsApp foi concluída.',
      );
    }
  }

  private async handleError(
    channel: Channel,
    error: { code?: number; message?: string },
  ): Promise<void> {
    const disabled = error.code === CoexistenceHistoryService.ERR_SYNC_DISABLED;
    this.logger.warn(
      `Coexistência: histórico NÃO virá para o canal ${channel.id} — ` +
        `${error.code ?? '?'} ${error.message ?? ''}`,
    );

    const job = await this.getOrCreateJob(channel);
    await this.prisma.channelSyncJob.update({
      where: { id: job.id },
      data: {
        status: ChannelSyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: `${error.code ?? ''} ${error.message ?? ''}`.trim(),
      },
    });

    await this.notify(
      channel,
      `Histórico não importado no canal "${channel.name}"`,
      disabled
        ? 'O cliente desativou o compartilhamento de histórico no app do WhatsApp Business. As conversas antigas não aparecerão no inbox; as novas seguem normalmente.'
        : `A Meta recusou o envio do histórico: ${error.message ?? error.code ?? 'motivo desconhecido'}.`,
    );
  }

  /** Um job por canal enquanto houver sincronização em andamento. */
  private async getOrCreateJob(channel: Channel) {
    const running = await this.prisma.channelSyncJob.findFirst({
      where: {
        channelId: channel.id,
        status: { in: [ChannelSyncStatus.PENDING, ChannelSyncStatus.RUNNING] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (running) return running;

    return this.prisma.channelSyncJob.create({
      data: {
        channelId: channel.id,
        status: ChannelSyncStatus.RUNNING,
        startedAt: new Date(),
        lookbackDays: 180,
        metadata: { source: 'coexistence_push' },
      },
    });
  }

  private async notify(channel: Channel, title: string, body: string) {
    await this.notifications
      .notifyOrgAgents({
        organizationId: channel.organizationId,
        roles: [OrgRole.OWNER, OrgRole.ADMIN],
        type: NotificationType.SYSTEM,
        title,
        body,
        data: { channelId: channel.id },
      })
      .catch((err) =>
        this.logger.error(
          `Falha ao notificar histórico do canal ${channel.id}: ${err.message}`,
        ),
      );
  }
}
