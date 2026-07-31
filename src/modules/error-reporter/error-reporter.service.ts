import { Injectable, Logger } from '@nestjs/common';
import { ErrorIssue, ErrorIssueStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorAlertService } from './error-alert.service';
import { buildFingerprint } from './error-fingerprint.util';
import { AlertKind, ErrorReportInput } from './error-reporter.types';

const TITLE_MAX = 200;

/**
 * Ponto único de entrada para registrar falha de produção.
 *
 * REGRA INEGOCIÁVEL: `report()` nunca lança e nunca rejeita. Um bug no
 * coletor de bug não pode derrubar produção. O retorno é `void` de propósito,
 * não `Promise` — assim ninguém é tentado a dar `await` no caminho quente de
 * um webhook e somar latência ao atendimento.
 *
 * `ingest()` é público só para teste e para quem realmente quiser esperar a
 * gravação. Ele também engole tudo.
 */
@Injectable()
export class ErrorReporterService {
  private readonly logger = new Logger(ErrorReporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alert: ErrorAlertService,
  ) {}

  /** Dispara e esquece. Seguro em qualquer contexto, inclusive num catch. */
  report(input: ErrorReportInput): void {
    void this.ingest(input).catch(() => undefined);
  }

  async ingest(input: ErrorReportInput): Promise<void> {
    try {
      const fingerprint = buildFingerprint(input);
      const title = input.message.slice(0, TITLE_MAX);
      const now = new Date();

      const existente = await this.prisma.errorIssue.findUnique({
        where: { fingerprint },
      });

      let issue: ErrorIssue;
      let kind: AlertKind;

      if (!existente) {
        try {
          issue = await this.prisma.errorIssue.create({
            data: {
              fingerprint,
              source: input.source,
              code: input.code,
              severity: input.severity,
              title,
              lastStack: input.stack ?? null,
              firstSeenAt: now,
              lastSeenAt: now,
              organizationId: input.organizationId ?? null,
            },
          });
          kind = 'new';
        } catch (err) {
          // Corrida: dois webhooks idênticos chegaram ao mesmo tempo e o
          // outro criou o issue primeiro. Cai no caminho de incremento.
          if (!isUniqueViolation(err)) throw err;
          const resultado = await this.bump(fingerprint, input, now);
          issue = resultado.issue;
          kind = resultado.kind;
        }
      } else {
        const resultado = await this.bump(fingerprint, input, now, existente);
        issue = resultado.issue;
        kind = resultado.kind;
      }

      await this.prisma.errorOccurrence.create({
        data: {
          issueId: issue.id,
          occurredAt: now,
          context: (input.context ?? {}) as Prisma.InputJsonValue,
          stack: input.stack ?? null,
          organizationId: input.organizationId ?? null,
          channelId: input.channelId ?? null,
          conversationId: input.conversationId ?? null,
          contactId: input.contactId ?? null,
          userId: input.userId ?? null,
        },
      });

      await this.alert.maybeAlert(issue, kind);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao registrar erro (${input.code}): ${msg}`);
    }
  }

  /** Incrementa o issue existente. Reabre se estava resolvido (regressão). */
  private async bump(
    fingerprint: string,
    input: ErrorReportInput,
    now: Date,
    conhecido?: { id: string; status: ErrorIssueStatus },
  ): Promise<{ issue: ErrorIssue; kind: AlertKind }> {
    const atual =
      conhecido ??
      (await this.prisma.errorIssue.findUnique({ where: { fingerprint } }));
    if (!atual) throw new Error(`issue sumiu apos conflito: ${fingerprint}`);

    const regressao = atual.status === ErrorIssueStatus.RESOLVED;
    const issue = await this.prisma.errorIssue.update({
      where: { id: atual.id },
      data: {
        count: { increment: 1 },
        lastSeenAt: now,
        ...(input.stack ? { lastStack: input.stack } : {}),
        ...(regressao
          ? { status: ErrorIssueStatus.OPEN, resolvedAt: null }
          : {}),
      },
    });
    return { issue, kind: regressao ? 'regression' : 'recurring' };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}
