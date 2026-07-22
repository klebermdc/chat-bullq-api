import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { phoneDigits } from '../../../sales-reports/reconciliation.match';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

/** Teto de pedidos devolvidos — a IA só precisa saber o panorama, não o extrato. */
const MAX_ROWS = 20;

/**
 * Últimos 8 dígitos do telefone, ou null se não der pra comparar.
 *
 * Mesma convenção da reconciliação de pedidos (`reconciliation.match`):
 * comparar só o final ignora divergência de DDI (55) e do 9º dígito, que
 * são a maior fonte de falso negativo em número brasileiro.
 */
export function phoneTail(raw?: string | null): string | null {
  const digits = phoneDigits(raw);
  return digits.length >= 8 ? digits.slice(-8) : null;
}

interface OrderRow {
  pedido: string | null;
  cliente: string | null;
  email_cliente: string | null;
  telefone_cliente: string | null;
  produto: string | null;
  status: string | null;
  venda: unknown;
  vendedor: string | null;
  data: Date | string | null;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
};

const toIso = (v: Date | string | null): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * ETAPA ZERO do prompt de vendas: o cliente já comprou com a gente?
 *
 * Oferecer um produto pra quem já comprou é o erro mais caro que a IA
 * comete — o cliente sente que ninguém olhou o histórico dele. Esta tool
 * responde isso antes de qualquer pitch.
 *
 * Fonte: espelho local `ofp_sales_orders`, populado pelo cron de sync do
 * OFP HUB. Consulta o espelho e NÃO o HUB ao vivo de propósito: a API
 * `ai-report` não sabe filtrar por telefone/e-mail (só vendedor/mês/ano),
 * então "buscar ao vivo" significaria paginar milhares de pedidos no meio
 * do turno da IA. O espelho é indexado e responde em milissegundos.
 *
 * Contrapartida conhecida: a frescura do dado é a do último sync. Quem
 * comprou nos últimos minutos pode ainda não aparecer — aceitável, porque
 * o custo do falso negativo (oferecer de novo) é o mesmo de hoje, e o
 * falso positivo (dizer que comprou sem ter comprado) não acontece.
 */
@Injectable()
export class CheckPurchaseTool implements AiTool {
  private readonly logger = new Logger(CheckPurchaseTool.name);

  readonly name = 'checkPurchase';
  readonly description =
    'Verifica se o cliente já comprou com a Orlando Fast Pass, consultando os pedidos do HUB por telefone e/ou e-mail. Use SEMPRE antes de oferecer qualquer produto (ETAPA ZERO) e quando o cliente disser "já comprei", "já sou cliente", "meu pedido". Sem argumentos, usa automaticamente o telefone/e-mail do contato da conversa. Retorna alreadyCustomer, a lista de pedidos (produto, valor, data, status, vendedor) e a data da última compra.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      phone: {
        type: 'string',
        description:
          'Telefone do cliente, em qualquer formato. Omita para usar o telefone do contato da conversa (o caso normal).',
        maxLength: 30,
      },
      email: {
        type: 'string',
        description:
          'E-mail do cliente. Omita para usar o e-mail cadastrado no contato. Só informe se o cliente disser um e-mail diferente durante a conversa.',
        maxLength: 200,
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const argPhone = String(input.phone ?? '').trim();
    const argEmail = String(input.email ?? '').trim().toLowerCase();

    // A LLM raramente tem telefone/e-mail em mãos — e quando "tem", às
    // vezes inventa. O contato da conversa é a fonte confiável, então ele
    // preenche o que o argumento não trouxe.
    let tail = phoneTail(argPhone);
    let email = argEmail || null;

    if (!tail || !email) {
      const contact = await this.prisma.contact.findUnique({
        where: { id: ctx.contactId },
        select: { phone: true, email: true, name: true },
      });
      tail = tail ?? phoneTail(contact?.phone);
      email = email ?? (contact?.email?.trim().toLowerCase() || null);
    }

    if (!tail && !email) {
      return {
        output: {
          ok: true,
          alreadyCustomer: false,
          needsIdentifier: true,
          purchases: [],
          guidance:
            'Não há telefone nem e-mail utilizável pra consultar. Siga o fluxo normal de venda. Se precisar confirmar histórico, peça o e-mail ao cliente de forma natural — NUNCA diga que está "consultando o sistema".',
        },
      };
    }

    let rows: OrderRow[];
    try {
      // Casa por final de telefone OU e-mail. As duas comparações têm
      // índice de expressão (ver migration add_ofp_orders_lookup_indexes)
      // — sem eles isto vira seq scan a cada mensagem da IA.
      rows = await this.prisma.$queryRaw<OrderRow[]>`
        SELECT pedido, cliente, email_cliente, telefone_cliente,
               produto, status, venda, vendedor, data
        FROM ofp_sales_orders
        WHERE (
          ${tail}::text IS NOT NULL
          AND RIGHT(REGEXP_REPLACE(COALESCE(telefone_cliente, ''), '[^0-9]', '', 'g'), 8) = ${tail}
          AND LENGTH(REGEXP_REPLACE(COALESCE(telefone_cliente, ''), '[^0-9]', '', 'g')) >= 8
        ) OR (
          ${email}::text IS NOT NULL
          AND LOWER(TRIM(COALESCE(email_cliente, ''))) = ${email}
        )
        ORDER BY data DESC NULLS LAST
        LIMIT ${MAX_ROWS}
      `;
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.logger.error(
        `checkPurchase falhou na consulta ao espelho (conv ${ctx.conversationId}): ${message}`,
      );
      // Falha real de infra — aqui `ok:false` é correto, acende o alerta.
      return { output: { ok: false, error: message } };
    }

    const purchases = rows.map((r) => ({
      pedido: r.pedido,
      produto: r.produto,
      valor: toNumber(r.venda),
      data: toIso(r.data),
      status: r.status,
      vendedor: r.vendedor,
    }));

    const products = [
      ...new Set(purchases.map((p) => p.produto).filter((p): p is string => !!p)),
    ];
    const dates = purchases.map((p) => p.data).filter((d): d is string => !!d);
    const lastPurchaseDate = dates.length ? dates.sort().at(-1)! : null;
    const alreadyCustomer = purchases.length > 0;

    this.logger.log(
      `checkPurchase conv=${ctx.conversationId} tail=${tail ?? '-'} email=${email ?? '-'} → ${purchases.length} pedido(s)`,
    );

    return {
      output: {
        ok: true,
        alreadyCustomer,
        purchaseCount: purchases.length,
        lastPurchaseDate,
        products,
        purchases,
        searchedBy: { phoneTail: tail, email },
        guidance: alreadyCustomer
          ? 'Cliente JÁ é comprador. NÃO ofereça de novo o que ele já tem na lista acima. Reconheça o histórico de forma natural ("vi aqui que você já viajou com a gente") e ofereça o próximo passo: suporte, complemento, nova data. Esta consulta é INVISÍVEL — não diga que checou o sistema.'
          : 'Nenhum pedido encontrado — trate como lead novo e siga o fluxo de venda consultiva. Isso NÃO é erro. O espelho depende do último sync do HUB, então uma compra de minutos atrás pode não aparecer: se o cliente afirmar que comprou, acredite nele e escale pro humano em vez de contestar.',
      },
    };
  }
}
