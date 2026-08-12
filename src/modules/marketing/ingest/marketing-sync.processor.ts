import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AdConnectionStatus, ErrorSeverity, ErrorSource, Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../../database/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { ErrorReporterService } from '../../error-reporter/error-reporter.service';
import { ERROR_CODES } from '../../error-reporter/error-codes';
import { classifyMetaError } from '../connection/meta-error.util';
import { AdConnectionRepository } from '../connection/ad-connection.repository';
import { MARKETING_SYNC_QUEUE } from '../marketing.constants';
import { MetaInsightsClient } from './meta-insights.client';
import { mapInsightRow } from './insights.mapper';
import type { MarketingSyncJobData } from './marketing-sync.queue';

@Processor(MARKETING_SYNC_QUEUE, { concurrency: 2 })
export class MarketingSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketingSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AdConnectionRepository,
    private readonly insights: MetaInsightsClient,
    private readonly crypto: CryptoService,
    private readonly errorReporter: ErrorReporterService,
  ) {
    super();
  }

  async process(job: Job<MarketingSyncJobData>): Promise<void> {
    const { connectionId, since, until } = job.data;

    const connection = await this.repo.findOneWithToken(connectionId);
    if (!connection) {
      // Desconectada entre o enfileiramento e a execução. Não é erro.
      this.logger.warn(`conexao ${connectionId} sumiu antes do sync`);
      return;
    }
    if (connection.status !== AdConnectionStatus.ACTIVE) {
      this.logger.warn(`conexao ${connectionId} nao esta ativa (${connection.status})`);
      return;
    }

    let rows: any[];
    try {
      rows = await this.insights.fetchAdInsights({
        adAccountId: connection.externalAccountId,
        token: this.crypto.decrypt(connection.accessTokenEnc),
        since,
        until,
      });
    } catch (err) {
      await this.handleFetchFailure(connection, err);
      return;
    }

    const syncedAt = new Date();
    let gravadas = 0;

    for (const raw of rows) {
      try {
        const row = mapInsightRow(raw, {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          syncedAt,
        });
        const { organizationId, connectionId: cid, date, adId, actions, ...rest } = row;
        // Campo Json nullable: o Prisma NÃO aceita `null` cru aqui, exige
        // Prisma.JsonNull. Passar null direto quebra em tempo de compilação.
        const payload = {
          ...rest,
          actions: actions === null ? Prisma.JsonNull : (actions as Prisma.InputJsonValue),
        };
        // Upsert na chave única: reprocessar a janela ATUALIZA, nunca duplica
        // nem soma. É o que torna a janela móvel segura.
        await this.prisma.adDailyStat.upsert({
          where: { connectionId_date_adId: { connectionId: cid, date, adId } },
          create: { organizationId, connectionId: cid, date, adId, ...payload },
          update: payload,
        });
        gravadas += 1;
      } catch (err) {
        // Uma linha estranha não pode custar o dia inteiro de dados.
        this.errorReporter.report({
          source: ErrorSource.JOB,
          code: ERROR_CODES.MARKETING_SYNC_FAILED,
          severity: ErrorSeverity.WARNING,
          message: `linha de insights invalida: ${(err as Error).message}`,
          organizationId: connection.organizationId,
          context: { connectionId, since, until },
        });
      }
    }

    await this.repo.markSynced(connection.id, syncedAt);
    this.logger.log(
      `sync conexao=${connectionId} janela=${since}..${until} linhas=${gravadas}/${rows.length}`,
    );
  }

  /**
   * Credencial morta é estado, não exceção: aposenta a conexão e NÃO relança
   * (repetir não vai consertar). Limite de requisição e falha de rede relançam
   * para o BullMQ tentar de novo.
   */
  private async handleFetchFailure(
    connection: { id: string; organizationId: string },
    err: unknown,
  ): Promise<void> {
    const failure = classifyMetaError(err);

    if (failure.kind === 'credential') {
      await this.repo.markFailed(connection.id, failure.message, failure.status);
      this.errorReporter.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.MARKETING_TOKEN_INVALID,
        severity: ErrorSeverity.ERROR,
        message: `Meta Ads: credencial invalida — ${failure.message}`,
        organizationId: connection.organizationId,
        context: { connectionId: connection.id, status: failure.status, metaCode: failure.code },
      });
      return;
    }

    if (failure.kind === 'rate_limit') {
      // Não mexe no status: a conta está viva, só pediu para esperar.
      this.logger.warn(`rate limit no sync ${connection.id}: ${failure.message}`);
      throw new Error(`rate limit da Meta: ${failure.message}`);
    }

    await this.repo.markFailed(connection.id, failure.message);
    this.errorReporter.report({
      source: ErrorSource.JOB,
      code: ERROR_CODES.MARKETING_SYNC_FAILED,
      severity: ErrorSeverity.ERROR,
      message: `Meta Ads: falha no sync — ${failure.message}`,
      organizationId: connection.organizationId,
      context: { connectionId: connection.id, metaCode: failure.code },
    });
    throw new Error(`falha no sync da Meta: ${failure.message}`);
  }
}
