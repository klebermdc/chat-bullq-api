import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorIssue,
  ErrorIssueStatus,
  ErrorSeverity,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ErrorAlertService } from './error-alert.service';
import { buildFingerprint } from './error-fingerprint.util';
import { AlertKind, ErrorReportInput } from './error-reporter.types';
import { redactSecrets, redactText } from './redact.util';

const TITLE_MAX = 200;

/**
 * Teto de ingestões simultâneas. Cada `ingest()` custa de 2 a 4 idas ao
 * banco, e num crashloop `report()` é chamado milhares de vezes por segundo.
 * Sem teto, o coletor de bug esgota o pool do Prisma e vira ele mesmo o
 * incidente — já aconteceu neste projeto com outro job. Perder relatório
 * repetido é barato; derrubar o banco não é.
 */
const MAX_INFLIGHT = 20;

/** CRITICAL > ERROR > WARNING. Só sobe: um erro que já foi grave continua grave. */
const SEVERITY_RANK: Record<ErrorSeverity, number> = {
  CRITICAL: 3,
  ERROR: 2,
  WARNING: 1,
};

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

  private emVoo = 0;
  private descartados = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alert: ErrorAlertService,
  ) {}

  /** Dispara e esquece. Seguro em qualquer contexto, inclusive num catch. */
  report(input: ErrorReportInput): void {
    if (this.emVoo >= MAX_INFLIGHT) {
      this.descartados += 1;
      // Log esparso: se está saturado, logar cada descarte só piora.
      if (this.descartados % 100 === 1) {
        this.logger.warn(
          `error-reporter saturado: ${this.descartados} relatorios descartados`,
        );
      }
      return;
    }
    this.emVoo += 1;
    void this.ingest(input)
      .catch(() => undefined)
      .finally(() => {
        this.emVoo -= 1;
      });
  }

  async ingest(input: ErrorReportInput): Promise<void> {
    try {
      // Fingerprint recebe o `input` CRU, sem redação. Ele agrupa erros
      // iguais entre si — se redigisse antes, dois erros com segredos
      // diferentes (ex.: dois tokens distintos expirando) colapsariam no
      // mesmo grupo, ou o inverso. Redação é para o que é GRAVADO e
      // ENVIADO, não para o que é hasheado.
      const fingerprint = buildFingerprint(input);
      const title = redactText(input.message).slice(0, TITLE_MAX);
      const stack = input.stack ? redactText(input.stack) : undefined;
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
              lastStack: stack ?? null,
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
          const resultado = await this.incrementOrReopen(
            fingerprint,
            input,
            now,
          );
          issue = resultado.issue;
          kind = resultado.kind;
        }
      } else {
        const resultado = await this.incrementOrReopen(
          fingerprint,
          input,
          now,
          existente,
        );
        issue = resultado.issue;
        kind = resultado.kind;
      }

      // Sem transação de propósito: `count` é histórico e as ocorrências são
      // podadas em 14 dias, então os dois números nunca batem mesmo. Uma
      // transação por erro só somaria pressão no pool que MAX_INFLIGHT protege.
      await this.prisma.errorOccurrence.create({
        data: {
          issueId: issue.id,
          occurredAt: now,
          // Redação central: nenhum ponto de coleta precisa lembrar de não
          // vazar segredo, porque tudo passa por aqui.
          context: redactSecrets(
            input.context ?? {},
          ) as Prisma.InputJsonValue,
          stack: stack ?? null,
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
  private async incrementOrReopen(
    fingerprint: string,
    input: ErrorReportInput,
    now: Date,
    conhecido?: {
      id: string;
      status: ErrorIssueStatus;
      severity: ErrorSeverity;
    },
  ): Promise<{ issue: ErrorIssue; kind: AlertKind }> {
    const atual =
      conhecido ??
      (await this.prisma.errorIssue.findUnique({ where: { fingerprint } }));
    if (!atual) throw new Error(`issue sumiu apos conflito: ${fingerprint}`);

    const regressao = atual.status === ErrorIssueStatus.RESOLVED;
    const escalou =
      SEVERITY_RANK[input.severity] > SEVERITY_RANK[atual.severity];
    const stack = input.stack ? redactText(input.stack) : undefined;
    const issue = await this.prisma.errorIssue.update({
      where: { id: atual.id },
      data: {
        count: { increment: 1 },
        lastSeenAt: now,
        ...(stack ? { lastStack: stack } : {}),
        ...(regressao
          ? { status: ErrorIssueStatus.OPEN, resolvedAt: null }
          : {}),
        ...(escalou ? { severity: input.severity } : {}),
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
