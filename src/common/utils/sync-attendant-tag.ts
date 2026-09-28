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
 * contato: remove a do atendente anterior (match exato pelo nome) e garante a
 * do novo (idempotente — chamar de novo pro mesmo atendente só "cura" a tag
 * que faltava).
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
      await db.conversationTag.deleteMany({
        where: { conversationId, tag: { organizationId, name: prevName } },
      });
      await db.contactTag.deleteMany({
        where: { contactId, tag: { organizationId, name: prevName } },
      });
    }
  }

  const nextName = await userName(db, toAssigneeId);
  if (!nextName) return;

  // Cor estável por atendente pra os selos ficarem distintos no inbox.
  const color = attendantTagColor(toAssigneeId);
  const tag = await db.tag.upsert({
    where: { organizationId_name: { organizationId, name: nextName } },
    create: { organizationId, name: nextName, color },
    update: {},
    select: { id: true, color: true },
  });
  // Backfill: selos antigos ficaram no cinza padrão. Recolore só esses —
  // nunca sobrescreve uma cor escolhida à mão.
  if (tag.color === DEFAULT_TAG_COLOR) {
    await db.tag.update({ where: { id: tag.id }, data: { color } });
  }
  await db.conversationTag.upsert({
    where: { conversationId_tagId: { conversationId, tagId: tag.id } },
    create: { conversationId, tagId: tag.id },
    update: {},
  });
  await db.contactTag.upsert({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
    create: { contactId, tagId: tag.id },
    update: {},
  });
}

async function userName(db: Db, userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  return (user?.name ?? '').trim();
}
