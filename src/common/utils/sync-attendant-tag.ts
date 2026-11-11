import { Prisma } from '@prisma/client';
import { attendantTagColor, DEFAULT_TAG_COLOR } from './attendant-tag-color.util';

type Db = Pick<
  Prisma.TransactionClient,
  'user' | 'tag' | 'conversationTag' | 'contactTag'
>;

export interface SyncAttendantTagParams {
  conversationId: string;
  contactId: string;
  organizationId: string;
  fromAssigneeId: string | null;
  toAssigneeId: string;
}

/**
 * Mantém a etiqueta do vendedor em sincronia com quem está atribuído.
 * A etiqueta é uma Tag com o NOME do atendente, na conversa E na ficha do
 * contato: remove a do atendente anterior e garante a do novo (idempotente —
 * chamar de novo pro mesmo atendente só "cura" a tag que faltava).
 *
 * O nome casa SEM diferenciar maiúsculas: a carteira antiga tem as etiquetas
 * em caixa alta ("BÁRBARA") e o usuário se chama "Bárbara". Casar exato criava
 * uma segunda etiqueta por vendedor e deixava a antiga presa na conversa.
 *
 * Todo caminho que grava `assignedToId` precisa chamar isto: o assign do FSM,
 * a auto-atribuição ao responder e a automação "Atribuir a um usuário".
 */
export async function syncAttendantTag(
  db: Db,
  {
    conversationId,
    contactId,
    organizationId,
    fromAssigneeId,
    toAssigneeId,
  }: SyncAttendantTagParams,
): Promise<void> {
  if (fromAssigneeId && fromAssigneeId !== toAssigneeId) {
    const prevName = await userName(db, fromAssigneeId);
    if (prevName) {
      const previousTag = {
        organizationId,
        name: { equals: prevName, mode: 'insensitive' as const },
      };
      await db.conversationTag.deleteMany({
        where: { conversationId, tag: previousTag },
      });
      await db.contactTag.deleteMany({
        where: { contactId, tag: previousTag },
      });
    }
  }

  const tagId = await ensureAttendantTag(db, organizationId, toAssigneeId);
  if (!tagId) return;
  await db.conversationTag.upsert({
    where: { conversationId_tagId: { conversationId, tagId } },
    create: { conversationId, tagId },
    update: {},
  });
  await db.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId } },
    create: { contactId, tagId },
    update: {},
  });
}

/**
 * Etiqueta do vendedor INCLUÍDO numa conversa (conversa compartilhada): só na
 * conversa, nunca na ficha do contato — a ficha diz de quem é a carteira, e
 * quem foi incluído só está ajudando.
 */
export async function addParticipantTag(
  db: Db,
  params: { conversationId: string; organizationId: string; userId: string },
): Promise<void> {
  const tagId = await ensureAttendantTag(db, params.organizationId, params.userId);
  if (!tagId) return;
  await db.conversationTag.upsert({
    where: {
      conversationId_tagId: { conversationId: params.conversationId, tagId },
    },
    create: { conversationId: params.conversationId, tagId },
    update: {},
  });
}

/** Tira a etiqueta do incluído da conversa quando ele sai (ou é tirado). */
export async function removeParticipantTag(
  db: Db,
  params: { conversationId: string; organizationId: string; userId: string },
): Promise<void> {
  const name = await userName(db, params.userId);
  if (!name) return;
  await db.conversationTag.deleteMany({
    where: {
      conversationId: params.conversationId,
      tag: {
        organizationId: params.organizationId,
        name: { equals: name, mode: 'insensitive' },
      },
    },
  });
}

/**
 * Etiqueta com o nome do atendente (cria se faltar), com cor estável por
 * atendente. Devolve o id, ou null se o usuário não tem nome.
 */
async function ensureAttendantTag(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const name = await userName(db, userId);
  if (!name) return null;
  const color = attendantTagColor(userId);
  const tag =
    (await db.tag.findFirst({
      where: { organizationId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, color: true },
    })) ??
    (await db.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name, color },
      update: {},
      select: { id: true, color: true },
    }));
  // Backfill: selos antigos ficaram no cinza padrão. Recolore só esses —
  // nunca sobrescreve uma cor escolhida à mão.
  if (tag.color === DEFAULT_TAG_COLOR) {
    await db.tag.update({ where: { id: tag.id }, data: { color } });
  }
  return tag.id;
}

async function userName(db: Db, userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  return (user?.name ?? '').trim();
}
