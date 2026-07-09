import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { OfpReportService, OfpOrder } from './ofp-report.service';

function parseDate(data: string | null): Date | null {
  if (!data) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(data.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}
const num = (v: unknown): number | null => (typeof v === 'number' && !isNaN(v) ? v : null);
const dt = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

@Injectable()
export class OfpSyncService {
  private readonly logger = new Logger(OfpSyncService.name);
  private running = false;

  constructor(
    private readonly ofp: OfpReportService,
    private readonly prisma: PrismaService,
  ) {}

  private toRow(o: OfpOrder) {
    return {
      externalId: o.id,
      pedido: o.pedido ?? null,
      cliente: o.cliente ?? null,
      emailCliente: o.email_cliente ?? null,
      telefoneCliente: o.telefone_cliente ?? null,
      vendedor: o.vendedor ?? null,
      fornecedor: o.fornecedor ?? null,
      produto: o.produto ?? null,
      status: o.status ?? null,
      venda: num(o.venda),
      comissao: num(o.comissao),
      comissaoTotal: num(o.comissao_total),
      porcentagemVendedor: num(o.porcentagem_vendedor),
      comissaoVendedor: num(o.comissao_vendedor),
      comissaoGuia: num(o.comissao_guia),
      enviado: typeof o.enviado === 'boolean' ? o.enviado : null,
      guia: o.guia ?? null,
      data: parseDate(o.data),
      dataRaw: o.data ?? null,
      createdAtExt: dt(o.created_at),
      updatedAtExt: dt(o.updated_at),
      syncedAt: new Date(),
    };
  }

  // Upsert de uma linha com retry curto. Falhas transitórias do banco (pool timeout,
  // deadlock, conexão derrubada) não devem abortar um sync de ~8500 linhas.
  private async upsertRowWithRetry(row: ReturnType<OfpSyncService['toRow']>): Promise<void> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.ofpSalesOrder.upsert({
          where: { externalId: row.externalId },
          create: row,
          update: row,
        });
        return;
      } catch (err: any) {
        if (attempt >= MAX_ATTEMPTS) throw err;
        this.logger.warn(
          `upsert ${row.externalId} falhou (tentativa ${attempt}/${MAX_ATTEMPTS}): ${err?.message}`,
        );
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
  }

  // NOTE: `running` is an in-process guard only. On a multi-replica deploy with the
  // cron enabled, replicas could sync concurrently — safe because upsert is idempotent,
  // but it is not a global lock. Single-instance deploy today.
  async sync(): Promise<{ count: number; lastSyncAt: Date; skipped?: boolean }> {
    if (this.running) {
      this.logger.warn('Sync já em andamento — ignorando chamada concorrente');
      return { count: 0, lastSyncAt: new Date(), skipped: true };
    }
    this.running = true;
    try {
      const orders = await this.ofp.getOrders();
      // Upsert em lotes paralelos (~8500 linhas) — bem mais rápido que sequencial.
      // Se interromper no meio, o próximo run se auto-corrige (upsert por externalId).
      const rows = orders.map((o) => this.toRow(o));
      // Concorrência baixa de propósito: em lotes maiores o upsert paralelo esgota o
      // pool de conexões do Prisma no VPS e derruba o sync inteiro com
      // "Timed out fetching a new connection from the connection pool". CHUNK pequeno
      // (<= pool) evita a fila; o retry por linha absorve hiccups transitórios do banco.
      const CHUNK = 5;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await Promise.all(
          rows.slice(i, i + CHUNK).map((row) => this.upsertRowWithRetry(row)),
        );
      }
      // Reconcile deletions: drop local rows no longer present upstream.
      // Guard: never wipe the table if the fetch came back empty (transient failure).
      const seen = orders.map((o) => o.id).filter(Boolean);
      if (seen.length > 0) {
        await this.prisma.ofpSalesOrder.deleteMany({ where: { externalId: { notIn: seen } } });
      }
      const lastSyncAt = new Date();
      await this.prisma.ofpSyncState.upsert({
        where: { id: 1 },
        create: { id: 1, lastSyncAt, lastCount: orders.length, lastError: null },
        update: { lastSyncAt, lastCount: orders.length, lastError: null },
      });
      this.logger.log(`OFP sync ok: ${orders.length} pedidos`);
      return { count: orders.length, lastSyncAt };
    } catch (err: any) {
      await this.prisma.ofpSyncState.upsert({
        where: { id: 1 },
        create: { id: 1, lastError: String(err?.message ?? err) },
        update: { lastError: String(err?.message ?? err) },
      });
      throw err;
    } finally {
      this.running = false;
    }
  }
}
