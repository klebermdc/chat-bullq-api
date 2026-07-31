import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ErrorIssue,
  ErrorIssueStatus,
  ErrorOccurrence,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListErrorsDto } from './dto/list-errors.dto';
import { UpdateErrorDto } from './dto/update-error.dto';

/** Quantas ocorrências o detalhe mostra. Além disso vira scroll infinito. */
const OCCURRENCES_LIMIT = 50;

export interface ErrorIssueListItem extends ErrorIssue {
  /** Contatos distintos nas ocorrências ainda retidas (janela de 14 dias). */
  impactedContacts: number;
}

/**
 * Lado de LEITURA do painel de bugs.
 *
 * Vive num módulo próprio, separado do `ErrorReporterModule` de propósito:
 * aquele é `@Global()` e não importa nada de domínio, porque é o que impede
 * o ciclo de DI que já derrubou a produção duas vezes. Pendurar controller e
 * guards nele seria arriscar justamente a peça que precisa continuar mínima.
 *
 * Não há escopo por organização aqui, e isso é intencional: o painel é do
 * superadmin da plataforma. `organizationId` é informação na tela, nunca
 * filtro de permissão — quem faz o corte é o `SuperAdminGuard` no controller.
 */
@Injectable()
export class ErrorPanelService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListErrorsDto): Promise<{
    items: ErrorIssueListItem[];
    total: number;
  }> {
    const page = dto.page ?? 1;
    const perPage = dto.perPage ?? 25;

    const where: Prisma.ErrorIssueWhereInput = {};
    if (dto.source) where.source = dto.source;
    if (dto.severity) where.severity = dto.severity;
    if (dto.status) where.status = dto.status;
    if (dto.q) {
      where.OR = [
        { title: { contains: dto.q, mode: 'insensitive' } },
        { code: { contains: dto.q, mode: 'insensitive' } },
      ];
    }

    const [issues, total] = await Promise.all([
      this.prisma.errorIssue.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.errorIssue.count({ where }),
    ]);

    const afetados = await this.impactedByIssue(issues.map((i) => i.id));

    return {
      items: issues.map((issue) => ({
        ...issue,
        impactedContacts: afetados.get(issue.id) ?? 0,
      })),
      total,
    };
  }

  async detail(
    id: string,
  ): Promise<
    ErrorIssue & { occurrences: ErrorOccurrence[]; impactedContacts: number }
  > {
    const issue = await this.prisma.errorIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue nao encontrado');

    const [occurrences, afetados] = await Promise.all([
      this.prisma.errorOccurrence.findMany({
        where: { issueId: id },
        orderBy: { occurredAt: 'desc' },
        take: OCCURRENCES_LIMIT,
      }),
      this.impactedByIssue([id]),
    ]);

    return { ...issue, occurrences, impactedContacts: afetados.get(id) ?? 0 };
  }

  async updateStatus(id: string, dto: UpdateErrorDto): Promise<ErrorIssue> {
    const existe = await this.prisma.errorIssue.findUnique({ where: { id } });
    if (!existe) throw new NotFoundException('Issue nao encontrado');

    const agora = new Date();
    return this.prisma.errorIssue.update({
      where: { id },
      data: {
        status: dto.status,
        // As duas datas são sempre reescritas juntas: sem isso, resolver um
        // issue silenciado deixaria o `mutedUntil` antigo pendurado e ele
        // voltaria mudo quando reabrisse por regressão.
        resolvedAt: dto.status === ErrorIssueStatus.RESOLVED ? agora : null,
        mutedUntil:
          dto.status === ErrorIssueStatus.MUTED && dto.mutedUntil
            ? new Date(dto.mutedUntil)
            : null,
      },
    });
  }

  /**
   * Contatos distintos por issue, numa consulta só para a página inteira.
   * Feito em SQL cru porque o `groupBy` do Prisma não faz COUNT(DISTINCT).
   * Sem isto seria um N+1 — 25 consultas por carregamento de tela.
   */
  private async impactedByIssue(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const linhas = await this.prisma.$queryRaw<
      Array<{ issue_id: string; n: bigint }>
    >`
      SELECT issue_id, COUNT(DISTINCT contact_id) AS n
      FROM error_occurrences
      WHERE issue_id = ANY(${ids}) AND contact_id IS NOT NULL
      GROUP BY issue_id
    `;
    return new Map(linhas.map((l) => [l.issue_id, Number(l.n)]));
  }
}
