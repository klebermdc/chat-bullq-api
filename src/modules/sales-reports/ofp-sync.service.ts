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
      // Sequential upsert of the full set (~8500 rows). If interrupted mid-loop,
      // the next run self-heals since every row is upserted by externalId.
      for (const o of orders) {
        const row = this.toRow(o);
        await this.prisma.ofpSalesOrder.upsert({
          where: { externalId: row.externalId },
          create: row,
          update: row,
        });
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
