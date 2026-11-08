import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Busca de contatos da base — usada pela tela de Contatos, pelo "Nova
 * conversa" e pela busca da inbox. Antes cada uma comparava o termo cru:
 * telefone com máscara não achava (o banco guarda só dígitos), "Joao" não
 * achava "João" e "Maria Silva" não achava "Maria da Silva".
 */

/** Abaixo disso o termo casaria metade do banco como telefone. */
const MIN_PHONE_DIGITS = 3;
/** Celular BR sem o 55: DDD (2) + 9 + 8 dígitos. */
const MOBILE_WITH_NINE = 11;
const MOBILE_WITHOUT_NINE = 10;
const MAX_NAME_TOKENS = 6;
const ACCENTED = 'áàâãäåéèêëíìîïóòôõöúùûüçñ';
const PLAIN = 'aaaaaaeeeeiiiiooooouuuucn';

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Formas do número a procurar. A carteira antiga da Umbler tem celular com e
 * sem o 9 da frente, e com e sem o 55.
 */
export function phoneVariants(digits: string): string[] {
  if (digits.length < MIN_PHONE_DIGITS) return [];
  const local = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : null;
  const base = local ?? digits;
  const out = [digits, ...(local ? [local] : [])];
  if (base.length === MOBILE_WITH_NINE && base[2] === '9') {
    out.push(base.slice(0, 2) + base.slice(3));
  } else if (base.length === MOBILE_WITHOUT_NINE) {
    out.push(`${base.slice(0, 2)}9${base.slice(2)}`);
  }
  return [...new Set(out)];
}

export interface ParsedContactSearch {
  /** Palavras do nome, sem acento e escapadas para LIKE. Todas precisam casar. */
  nameTokens: string[];
  /** Variantes do telefone (só dígitos). Qualquer uma casa. */
  phones: string[];
  /** Termo inteiro, sem acento, para e-mail. */
  email: string;
}

export function parseContactSearch(term: string): ParsedContactSearch | null {
  const trimmed = (term || '').trim();
  if (!trimmed) return null;
  const nameTokens = stripAccents(trimmed)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_NAME_TOKENS)
    .map(escapeLike);
  return {
    nameTokens,
    phones: phoneVariants(trimmed.replace(/\D/g, '')),
    email: escapeLike(stripAccents(trimmed)),
  };
}

function matchSql(p: ParsedContactSearch): Prisma.Sql {
  const plainName = Prisma.sql`translate(lower(coalesce(c.name, '')), ${ACCENTED}, ${PLAIN})`;
  const nameAll = Prisma.join(
    p.nameTokens.map((t) => Prisma.sql`${plainName} LIKE ${`%${t}%`}`),
    ' AND ',
  );
  const clauses = [
    Prisma.sql`(${nameAll})`,
    Prisma.sql`lower(coalesce(c.email, '')) LIKE ${`%${p.email}%`}`,
    ...p.phones.map((v) => Prisma.sql`c.phone LIKE ${`%${v}%`}`),
  ];
  return Prisma.join(clauses, ' OR ');
}

type RawQuery = Pick<PrismaClient, '$queryRaw'>;

/**
 * Ids dos contatos que casam o termo, do mais recente para o mais antigo,
 * com o total para paginação. Uma consulta só (total por window function).
 */
export async function findContactIdsBySearch(
  prisma: RawQuery,
  organizationId: string,
  term: string,
  page: { take: number; skip?: number },
): Promise<{ ids: string[]; total: number }> {
  const parsed = parseContactSearch(term);
  if (!parsed || parsed.nameTokens.length === 0) return { ids: [], total: 0 };
  const rows = await prisma.$queryRaw<{ id: string; total: bigint }[]>(Prisma.sql`
    SELECT c.id, count(*) OVER () AS total
    FROM contacts c
    WHERE c.organization_id = ${organizationId}
      AND c.deleted_at IS NULL
      AND (${matchSql(parsed)})
    ORDER BY c.updated_at DESC
    LIMIT ${page.take} OFFSET ${page.skip ?? 0}
  `);
  return { ids: rows.map((r) => r.id), total: rows.length ? Number(rows[0].total) : 0 };
}
