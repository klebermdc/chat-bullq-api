import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { escapeLikeTerm } from './message-search';

@Injectable()
export class MessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.MessageUncheckedCreateInput) {
    return this.prisma.message.create({ data });
  }

  async findByConversation(
    conversationId: string,
    skip: number,
    take: number,
  ) {
    const [messages, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.message.count({ where: { conversationId } }),
    ]);
    return { messages: messages.reverse(), total };
  }

  /**
   * Timeline UNIFICADA de um grupo de segmento: une as mensagens de várias
   * conversas-irmãs (mesmo grupo em canais diferentes), deduplicando pelo
   * `external_id` (o messageid do WhatsApp é o mesmo nas duas cópias) e
   * ordenando pelo tempo do provedor (fallback created_at).
   *
   * Faz a dedup/ordenação/paginação em SQL (só ids), depois carrega as linhas
   * completas com o include de sender, preservando a ordem.
   */
  async findByConversationsUnioned(
    conversationIds: string[],
    skip: number,
    take: number,
  ) {
    const ids = Prisma.join(conversationIds);

    const [pageRows, countRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ id: string }[]>`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(external_id, id)
                   ORDER BY COALESCE(provider_timestamp, created_at) ASC
                 ) AS rn
          FROM messages
          WHERE conversation_id IN (${ids})
        )
        SELECT r.id
        FROM ranked r
        JOIN messages m ON m.id = r.id
        WHERE r.rn = 1
        ORDER BY COALESCE(m.provider_timestamp, m.created_at) DESC
        LIMIT ${take} OFFSET ${skip}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT DISTINCT COALESCE(external_id, id) AS k
          FROM messages
          WHERE conversation_id IN (${ids})
        ) t
      `,
    ]);

    const pageIds = pageRows.map((r) => r.id);
    const total = Number(countRows[0]?.count ?? 0);
    // Preserva a ordem do page (desc) e devolve ascendente, igual a findByConversation.
    const ordered = await this.hydrate(pageIds);
    return { messages: ordered.reverse(), total };
  }

  /**
   * Carrega as linhas completas de uma página de ids, preservando a ordem em
   * que os ids chegaram — o `IN` do Postgres não garante ordem nenhuma.
   */
  private async hydrate(pageIds: string[]) {
    if (pageIds.length === 0) return [];
    const rows = await this.prisma.message.findMany({
      where: { id: { in: pageIds } },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const byId = new Map(rows.map((m) => [m.id, m]));
    return pageIds.map((id) => byId.get(id)!).filter(Boolean);
  }

  /**
   * Chave de ordenação da timeline. A conversa única segue `created_at`, que é
   * o que a página 1 já usa — misturar as duas chaves abriria buracos e
   * repetições na emenda entre as páginas. O grupo de segmento ordena pelo
   * tempo do provedor, porque a mesma mensagem chega pelos canais-irmãos com
   * latências diferentes.
   */
  private orderKey(unioned: boolean) {
    return unioned
      ? Prisma.sql`COALESCE(provider_timestamp, created_at)`
      : Prisma.sql`created_at`;
  }

  /**
   * Página das mensagens ANTERIORES à âncora — o "rolar pra cima" do chat.
   * Devolve em ordem cronológica. `hasMore` falso significa começo do histórico.
   */
  async findOlderThan(
    conversationIds: string[],
    unioned: boolean,
    beforeMessageId: string,
    take: number,
  ) {
    const key = this.orderKey(unioned);
    const ids = Prisma.join(conversationIds);

    // Pede uma linha a mais só para saber se ainda há histórico atrás.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH anchor AS (
        SELECT ${key} AS k FROM messages WHERE id = ${beforeMessageId}
      ), ranked AS (
        SELECT id, ${key} AS k,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(external_id, id) ORDER BY ${key} ASC
               ) AS rn
        FROM messages
        WHERE conversation_id IN (${ids})
      )
      SELECT r.id FROM ranked r, anchor a
      WHERE r.rn = 1 AND r.k < a.k
      ORDER BY r.k DESC
      LIMIT ${take + 1}
    `;

    const hasMore = rows.length > take;
    const pageIds = rows.slice(0, take).map((r) => r.id);
    const messages = await this.hydrate(pageIds);
    return { messages: messages.reverse(), hasMore };
  }

  /**
   * Janela em volta de uma mensagem — o destino do "pular até" da busca.
   * `isAtEnd` diz se a janela alcança o fim da conversa; o chat usa isso para
   * decidir se mensagem nova pode entrar no fim ou vira aviso de "nova ↓".
   */
  async findWindowAround(
    conversationIds: string[],
    unioned: boolean,
    anchorMessageId: string,
    radius: number,
  ) {
    const key = this.orderKey(unioned);
    const ids = Prisma.join(conversationIds);

    // Dois lados, duas consultas. Um UNION ALL com ORDER BY dentro de cada ramo
    // não garante a ordem das linhas na saída — a janela sairia embaralhada em
    // qualquer plano que resolvesse os ramos fora de ordem.
    const ranked = Prisma.sql`
      WITH anchor AS (
        SELECT ${key} AS k FROM messages WHERE id = ${anchorMessageId}
      ), ranked AS (
        SELECT id, ${key} AS k,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(external_id, id) ORDER BY ${key} ASC
               ) AS rn
        FROM messages
        WHERE conversation_id IN (${ids})
      )
    `;

    // Uma linha a mais de cada lado só para saber se a janela tem continuação.
    const [beforeRows, afterRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        ${ranked}
        SELECT r.id FROM ranked r, anchor a
        WHERE r.rn = 1 AND r.k <= a.k
        ORDER BY r.k DESC LIMIT ${radius + 1}
      `,
      this.prisma.$queryRaw<{ id: string }[]>`
        ${ranked}
        SELECT r.id FROM ranked r, anchor a
        WHERE r.rn = 1 AND r.k > a.k
        ORDER BY r.k ASC LIMIT ${radius + 1}
      `,
    ]);

    const hasOlder = beforeRows.length > radius;
    const isAtEnd = afterRows.length <= radius;
    const pageIds = [
      ...beforeRows.slice(0, radius).reverse(),
      ...afterRows.slice(0, radius),
    ].map((r) => r.id);

    return { messages: await this.hydrate(pageIds), hasOlder, isAtEnd };
  }

  /**
   * Busca por conteúdo dentro da conversa (e das irmãs de segmento). Procura no
   * texto e na legenda da mídia, que são as duas chaves onde o operador escreve.
   *
   * Sem índice dedicado de propósito: o filtro por `conversation_id` já cai no
   * `idx_msg_conv_time` e sobram poucas centenas de linhas por conversa, onde o
   * ILIKE é barato. GIN/pg_trgm só se a busca um dia virar global.
   */
  async searchInConversations(
    conversationIds: string[],
    term: string,
    limit: number,
  ) {
    const pattern = `%${escapeLikeTerm(term)}%`;
    const ids = Prisma.join(conversationIds);

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH ranked AS (
        SELECT id, content, revoked_at,
               COALESCE(provider_timestamp, created_at) AS k,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(external_id, id)
                 ORDER BY COALESCE(provider_timestamp, created_at) ASC
               ) AS rn
        FROM messages
        WHERE conversation_id IN (${ids})
      )
      SELECT id FROM ranked
      WHERE rn = 1
        AND revoked_at IS NULL
        AND (
          content->>'text' ILIKE ${pattern} ESCAPE '\\'
          OR content->>'caption' ILIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY k DESC
      LIMIT ${limit}
    `;

    return this.hydrate(rows.map((r) => r.id));
  }

  async findById(id: string) {
    return this.prisma.message.findUnique({ where: { id } });
  }

  async updateStatus(id: string, data: Prisma.MessageUpdateInput) {
    return this.prisma.message.update({ where: { id }, data });
  }
}
