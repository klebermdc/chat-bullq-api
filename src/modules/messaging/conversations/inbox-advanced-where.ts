import { Prisma } from '@prisma/client';

/**
 * Filtros avançados da inbox — os que o painel de filtros ganhou em nov/2026
 * (vários atendentes, etiqueta "todas"/excluída, etapa do funil, venda
 * perdida, origem anúncio, parado há X). Cada filtro vira um bloco próprio
 * que entra no `AND` da consulta: OR por dentro, AND entre eles.
 */
export interface InboxAdvancedFilters {
  /** Etiquetas pedidas (conversa OU contato). */
  tagIds?: string[];
  /** 'any' (padrão) = pelo menos uma; 'all' = todas. */
  tagMatch?: 'any' | 'all';
  /** Etiquetas que a conversa e o contato NÃO podem ter. */
  excludeTagIds?: string[];
  /** Vários atendentes de uma vez. */
  assignedToIds?: string[];
  /** Junto com `assignedToIds`, inclui também as sem atendente. */
  assignedToNone?: boolean;
  /** Etapas do funil: card ABERTO da conversa ou do contato. */
  stageIds?: string[];
  lost?: 'only' | 'exclude';
  /** Códigos de LOST_REASONS. Só valem com `lost: 'only'`. */
  lostReasons?: string[];
  /** 'ad' = contato chegou por anúncio (CTWA); 'organic' = não. */
  origin?: 'ad' | 'organic';
  /** Última mensagem anterior a este instante ("parado há mais de X"). */
  idleBefore?: Date;
  /** Fase do lead sem atendente: 'sdr' = com a IA; 'queue' = na fila (Distribuir). */
  phases?: LeadPhase[];
}

export const LEAD_PHASES = ['sdr', 'queue'] as const;
export type LeadPhase = (typeof LEAD_PHASES)[number];

type Block = Prisma.ConversationWhereInput;

const hasAny = (list?: string[]): list is string[] => !!list && list.length > 0;

function tagBlocks(f: InboxAdvancedFilters): Block[] {
  const blocks: Block[] = [];
  if (hasAny(f.tagIds)) {
    if (f.tagMatch === 'all') {
      blocks.push(
        ...f.tagIds.map((tagId) => ({
          OR: [
            { tags: { some: { tagId } } },
            { contact: { tags: { some: { tagId } } } },
          ],
        })),
      );
    } else {
      // Operadores etiquetam tanto a conversa quanto o contato e esperam
      // achar pelas duas.
      blocks.push({
        OR: [
          { tags: { some: { tagId: { in: f.tagIds } } } },
          { contact: { tags: { some: { tagId: { in: f.tagIds } } } } },
        ],
      });
    }
  }
  if (hasAny(f.excludeTagIds)) {
    blocks.push({
      tags: { none: { tagId: { in: f.excludeTagIds } } },
      contact: { tags: { none: { tagId: { in: f.excludeTagIds } } } },
    });
  }
  return blocks;
}

function assigneeBlock(f: InboxAdvancedFilters): Block | null {
  // "Sem atendente" sozinho continua no caminho antigo (where.assignedToId = null).
  if (!hasAny(f.assignedToIds)) return null;
  const OR: Block[] = [{ assignedToId: { in: f.assignedToIds } }];
  if (f.assignedToNone) OR.push({ assignedToId: null });
  return { OR };
}

function stageBlock(f: InboxAdvancedFilters): Block | null {
  if (!hasAny(f.stageIds)) return null;
  const card = { some: { stageId: { in: f.stageIds }, status: 'OPEN' as const } };
  // Card pode estar ligado só ao contato (criado fora da conversa).
  return { OR: [{ cards: card }, { contact: { cards: card } }] };
}

function lostBlock(f: InboxAdvancedFilters): Block | null {
  if (f.lost === 'exclude') return { lostAt: null };
  if (f.lost !== 'only') return null;
  return hasAny(f.lostReasons)
    ? { lostAt: { not: null }, lostReason: { in: f.lostReasons } }
    : { lostAt: { not: null } };
}

function originBlock(f: InboxAdvancedFilters): Block | null {
  if (f.origin === 'ad') {
    return {
      contact: {
        OR: [{ ctwaClid: { not: null } }, { ctwaSourceId: { not: null } }],
      },
    };
  }
  if (f.origin === 'organic') {
    return { contact: { ctwaClid: null, ctwaSourceId: null } };
  }
  return null;
}

/**
 * Mesma regra dos rótulos da lista de conversas (web, LEAD_PHASE): conversa
 * aberta e sem atendente; "Na fila" quando algum card dela está na etapa
 * "Distribuir", "Com a IA" quando nenhum está.
 */
function phaseBlock(f: InboxAdvancedFilters): Block | null {
  if (!hasAny(f.phases)) return null;
  const distribute: Block = {
    cards: { some: { stage: { name: { contains: 'distribu', mode: 'insensitive' } } } },
  };
  const OR: Block[] = [];
  if (f.phases.includes('sdr')) OR.push({ NOT: distribute });
  if (f.phases.includes('queue')) OR.push(distribute);
  return { status: { not: 'CLOSED' }, assignedToId: null, OR };
}

export function buildAdvancedBlocks(f: InboxAdvancedFilters): Block[] {
  const single = [
    assigneeBlock(f),
    stageBlock(f),
    lostBlock(f),
    originBlock(f),
    phaseBlock(f),
    f.idleBefore ? { lastMessageAt: { lte: f.idleBefore } } : null,
  ].filter((b): b is Block => b !== null);
  return [...tagBlocks(f), ...single];
}
