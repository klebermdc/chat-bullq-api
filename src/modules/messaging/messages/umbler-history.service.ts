import { Injectable } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';
import { ContactHistoryService } from './contact-history.service';
import { phoneVariants } from './phone-identity';

/** Um atendimento da Umbler (contato + canal), usado nas divisórias. */
export interface UmblerConversationBrief {
  channelName: string;
  sectorName: string | null;
  contactName: string | null;
  startedAt: Date | null;
  tags: string[];
  attendants: string[];
}

export interface UmblerMessage {
  id: string;
  conversationId: string;
  sentAt: Date;
  /** Contact = cliente; Member = atendente; Bot = robô da Umbler. */
  origin: string;
  /** Tipo da Umbler (Text, Audio, Image, File...), não o enum do Sendtur. */
  type: string;
  text: string;
  author: string | null;
  file: { url: string; name: string | null; mimeType: string | null } | null;
  isPrivate: boolean;
}

export interface UmblerHistoryAvailability {
  conversations: number;
  messages: number;
  oldestAt: Date | null;
  newestAt: Date | null;
}

export interface UmblerHistoryPage {
  messages: UmblerMessage[];
  hasMore: boolean;
  conversations: Record<string, UmblerConversationBrief>;
}

export interface UmblerPageQuery {
  limit: number;
  /** Data e id da mensagem mais antiga já carregada; sem eles, a página mais recente. */
  beforeAt?: Date;
  beforeId?: string;
}

interface UmblerRow {
  id: string;
  conversa_id: string;
  enviada_em: Date;
  origem: string | null;
  tipo: string | null;
  conteudo: string | null;
  autor: string | null;
  arquivo_url: string | null;
  arquivo_nome: string | null;
  arquivo_tipo: string | null;
  privada: boolean;
  canal_nome: string | null;
  setor_nome: string | null;
  contato_nome: string | null;
  criada_em: Date | null;
  etiquetas: string[] | null;
  atendentes: string[] | null;
}

const EMPTY_AVAILABILITY: UmblerHistoryAvailability = {
  conversations: 0,
  messages: 0,
  oldestAt: null,
  newestAt: null,
};

/**
 * Histórico importado da Umbler (2025–2026), somente leitura.
 *
 * Fica em tabelas próprias e é ligado ao cliente pelo TELEFONE, não por um
 * contato: assim aparece em qualquer contato do Sendtur com o mesmo número —
 * os da carteira importada, um lead novo do anúncio ou a mesma pessoa em dois
 * canais. Não tem canal do Sendtur, então herda o acesso da conversa aberta.
 */
@Injectable()
export class UmblerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactHistory: ContactHistoryService,
  ) {}

  async availability(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<UmblerHistoryAvailability> {
    const variants = await this.entryPhoneVariants(conversationId, organizationId, access, currentUserId, role);
    if (variants.length === 0) return EMPTY_AVAILABILITY;

    const [row] = await this.prisma.$queryRaw<
      { conversations: number; messages: number; oldest: Date | null; newest: Date | null }[]
    >(Prisma.sql`
      SELECT count(DISTINCT c.id)::int AS conversations,
             count(m.id)::int          AS messages,
             min(m.enviada_em)         AS oldest,
             max(m.enviada_em)         AS newest
        FROM umbler_historico_conversas c
        LEFT JOIN umbler_historico_mensagens m ON m.conversa_id = c.id
       WHERE c.organization_id = ${organizationId}
         AND c.telefone = ANY(${variants}::text[])
    `);
    if (!row) return EMPTY_AVAILABILITY;
    return {
      conversations: row.conversations,
      messages: row.messages,
      oldestAt: row.oldest,
      newestAt: row.newest,
    };
  }

  async findOlder(
    conversationId: string,
    organizationId: string,
    page: UmblerPageQuery,
    access: ChannelAccess,
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<UmblerHistoryPage> {
    const variants = await this.entryPhoneVariants(conversationId, organizationId, access, currentUserId, role);
    if (variants.length === 0) return { messages: [], hasMore: false, conversations: {} };

    const cursor =
      page.beforeAt && page.beforeId
        ? Prisma.sql`AND (m.enviada_em, m.id) < (${page.beforeAt}, ${page.beforeId})`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<UmblerRow[]>(Prisma.sql`
      SELECT m.id, m.conversa_id, m.enviada_em, m.origem, m.tipo, m.conteudo, m.autor,
             m.arquivo_url, m.arquivo_nome, m.arquivo_tipo, m.privada,
             c.canal_nome, c.setor_nome, c.contato_nome, c.criada_em, c.etiquetas, c.atendentes
        FROM umbler_historico_conversas c
        JOIN umbler_historico_mensagens m ON m.conversa_id = c.id
       WHERE c.organization_id = ${organizationId}
         AND c.telefone = ANY(${variants}::text[])
         ${cursor}
       ORDER BY m.enviada_em DESC, m.id DESC
       LIMIT ${page.limit + 1}
    `);

    const hasMore = rows.length > page.limit;
    const pageRows = rows.slice(0, page.limit).reverse();
    return {
      messages: pageRows.map(toMessage),
      hasMore,
      conversations: briefsOf(pageRows),
    };
  }

  private async entryPhoneVariants(
    conversationId: string,
    organizationId: string,
    access: ChannelAccess,
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<string[]> {
    const contact = await this.contactHistory.resolveEntryContact(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );
    return phoneVariants(contact.phone);
  }
}

function toMessage(row: UmblerRow): UmblerMessage {
  return {
    id: row.id,
    conversationId: row.conversa_id,
    sentAt: row.enviada_em,
    origin: row.origem ?? '',
    type: row.tipo ?? '',
    text: row.conteudo ?? '',
    author: row.autor || null,
    file: row.arquivo_url
      ? { url: row.arquivo_url, name: row.arquivo_nome || null, mimeType: row.arquivo_tipo || null }
      : null,
    isPrivate: row.privada,
  };
}

function briefsOf(rows: UmblerRow[]): Record<string, UmblerConversationBrief> {
  const briefs: Record<string, UmblerConversationBrief> = {};
  for (const row of rows) {
    if (briefs[row.conversa_id]) continue;
    briefs[row.conversa_id] = {
      channelName: row.canal_nome ?? '',
      sectorName: row.setor_nome || null,
      contactName: row.contato_nome || null,
      startedAt: row.criada_em,
      tags: row.etiquetas ?? [],
      attendants: row.atendentes ?? [],
    };
  }
  return briefs;
}
