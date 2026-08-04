import { Injectable, Logger } from '@nestjs/common';
import { EmailSubscriberSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizeEmail } from '../email-core/email-address.util';
import { normalizeCategories, normalizeSupplier, parsePurchaseDate } from './hub-normalize.util';
import { PurchaseEnrichment, SubscribersService } from './subscribers.service';

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface CsvRow {
  email: string;
  name?: string;
}

interface ImportRow {
  email: string | null;
  name?: string | null;
  source: EmailSubscriberSource;
  contactId?: string;
  consentSource?: string;
  enrichment?: PurchaseEnrichment;
}

/** Formato mínimo lido de `ofp_sales_orders` — um pedido, não uma pessoa. */
export interface SalesOrderRow {
  emailCliente: string | null;
  cliente: string | null;
  venda: unknown; // Prisma.Decimal | number | null — convertido por `toAmount`
  produto: string | null;
  fornecedor: string | null;
  data: Date | null;
}

/** Uma pessoa, depois de somar todos os pedidos dela. */
export interface AggregatedCustomer {
  email: string;
  name: string | null;
  totalSpent: number;
  orderCount: number;
  categories: string[];
  suppliers: string[];
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
}

/** `Prisma.Decimal` não é `number`; nulo do HUB conta como zero, nunca como NaN. */
function toAmount(venda: unknown): number {
  if (venda == null) return 0;
  if (typeof venda === 'number') return venda;
  if (typeof venda === 'object' && 'toNumber' in (venda as { toNumber?: unknown })) {
    return (venda as { toNumber: () => number }).toNumber();
  }
  const n = Number(venda);
  return Number.isNaN(n) ? 0 : n;
}

interface CustomerAccumulator {
  email: string;
  name: string | null;
  totalSpent: number;
  orderCount: number;
  categories: Set<string>;
  suppliers: Set<string>;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
}

/**
 * Agrupa pedidos por email normalizado ANTES de gravar — nove pedidos da
 * mesma pessoa viram um destinatário, nunca nove upserts.
 *
 * Pedido sem email não entra em grupo nenhum: quem chama decide o que fazer
 * com a ausência (aqui, vira `skipped` no relatório de importação).
 */
export function aggregateSalesOrders(orders: SalesOrderRow[]): AggregatedCustomer[] {
  const groups = new Map<string, CustomerAccumulator>();

  for (const order of orders) {
    const email = normalizeEmail(order.emailCliente);
    if (!email) continue;

    const group =
      groups.get(email) ??
      ({
        email,
        name: null,
        totalSpent: 0,
        orderCount: 0,
        categories: new Set<string>(),
        suppliers: new Set<string>(),
        firstPurchaseAt: null,
        lastPurchaseAt: null,
      } satisfies CustomerAccumulator);

    if (!group.name && order.cliente?.trim()) group.name = order.cliente.trim();
    group.totalSpent += toAmount(order.venda);
    group.orderCount += 1;
    for (const categoria of normalizeCategories(order.produto)) group.categories.add(categoria);
    const fornecedor = normalizeSupplier(order.fornecedor);
    if (fornecedor) group.suppliers.add(fornecedor);

    const compra = parsePurchaseDate(order.data);
    if (compra) {
      if (!group.firstPurchaseAt || compra < group.firstPurchaseAt) group.firstPurchaseAt = compra;
      if (!group.lastPurchaseAt || compra > group.lastPurchaseAt) group.lastPurchaseAt = compra;
    }

    groups.set(email, group);
  }

  return [...groups.values()].map((g) => ({
    email: g.email,
    name: g.name,
    totalSpent: g.totalSpent,
    orderCount: g.orderCount,
    categories: [...g.categories],
    suppliers: [...g.suppliers],
    firstPurchaseAt: g.firstPurchaseAt,
    lastPurchaseAt: g.lastPurchaseAt,
  }));
}

/** Parser deliberadamente simples: `email[,;]nome` por linha, cabeçalho opcional. */
export function parseCsv(raw: string): CsvRow[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line, i) => !(i === 0 && /^e-?mail\b/i.test(line)))
    .map((line) => {
      const [email, name] = line.split(/[,;]/).map((p) => p?.trim());
      return { email, name: name || undefined };
    });
}

@Injectable()
export class SubscriberImportService {
  private readonly logger = new Logger(SubscriberImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscribers: SubscribersService,
  ) {}

  private async importRows(organizationId: string, rows: ImportRow[]): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
    for (const row of rows) {
      if (!row.email) {
        result.skipped++;
        continue;
      }
      try {
        await this.subscribers.upsert(organizationId, {
          email: row.email,
          name: row.name ?? undefined,
          source: row.source,
          contactId: row.contactId,
          consentSource: row.consentSource,
          enrichment: row.enrichment,
        });
        result.imported++;
      } catch (err) {
        // Linha ruim não derruba a importação inteira, mas também não some:
        // vai para o relatório que o operador vê.
        result.errors.push(`${row.email}: ${(err as Error).message}`);
      }
    }
    if (result.errors.length) {
      this.logger.warn(`importação com ${result.errors.length} linha(s) rejeitada(s)`);
    }
    return result;
  }

  async fromContacts(organizationId: string): Promise<ImportResult> {
    const contacts = await this.prisma.contact.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, email: true, name: true },
    });
    return this.importRows(
      organizationId,
      contacts.map((c) => ({
        email: c.email,
        name: c.name,
        contactId: c.id,
        consentSource: 'crm:contato',
        source: EmailSubscriberSource.CRM_CONTACT,
      })),
    );
  }

  async fromSalesOrders(organizationId: string): Promise<ImportResult> {
    const orders = await this.prisma.ofpSalesOrder.findMany({
      select: { emailCliente: true, cliente: true, venda: true, produto: true, fornecedor: true, data: true },
    });
    // Agrega ANTES de gravar: nove pedidos da mesma pessoa geram um upsert,
    // não nove — ler pedido a pedido nunca soma nada.
    const customers = aggregateSalesOrders(orders);
    return this.importRows(
      organizationId,
      customers.map((c) => ({
        email: c.email,
        name: c.name,
        consentSource: `hub:${c.orderCount} pedido(s)`,
        source: EmailSubscriberSource.OFP_ORDER,
        enrichment: {
          firstPurchaseAt: c.firstPurchaseAt,
          lastPurchaseAt: c.lastPurchaseAt,
          totalSpent: c.totalSpent,
          orderCount: c.orderCount,
          categories: c.categories,
          suppliers: c.suppliers,
        },
      })),
    );
  }

  async fromCsv(organizationId: string, raw: string): Promise<ImportResult> {
    return this.importRows(
      organizationId,
      parseCsv(raw).map((r) => ({
        email: r.email,
        name: r.name,
        consentSource: 'csv:import',
        source: EmailSubscriberSource.CSV_IMPORT,
      })),
    );
  }
}
