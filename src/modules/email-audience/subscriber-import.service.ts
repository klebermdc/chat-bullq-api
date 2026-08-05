import { Injectable, Logger } from '@nestjs/common';
import { EmailSubscriberSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SubscribersService } from './subscribers.service';

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

  /**
   * `OfpSalesOrder` é espelho GLOBAL do HUB — a tabela não tem
   * `organizationId`, então esta consulta não tem por onde filtrar por
   * organização. Isso é por desenho, não um bug: hoje só existe uma
   * operação usando este banco. A mitigação cabível é restringir quem pode
   * chamar esta rota (`email.view`, OWNER/ADMIN — ver `@Feature` no
   * controller); não há como "consertar" o filtro em si. Se um dia duas
   * operações passarem a dividir o mesmo banco, esta importação passaria a
   * trazer clientes de uma operação para a lista de email da outra.
   */
  async fromSalesOrders(organizationId: string): Promise<ImportResult> {
    const orders = await this.prisma.ofpSalesOrder.findMany({
      select: { emailCliente: true, cliente: true, pedido: true },
    });
    return this.importRows(
      organizationId,
      orders.map((o) => ({
        email: o.emailCliente,
        name: o.cliente,
        consentSource: `hub:pedido-${o.pedido ?? 'sem-numero'}`,
        source: EmailSubscriberSource.OFP_ORDER,
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
