import { PrismaService } from '../../database/prisma.service';

/** Etiqueta da org pelo nome, ignorando maiúsculas ("site" cai na "Site"). */
export async function findOrCreateTag(
  prisma: PrismaService,
  organizationId: string,
  name: string,
): Promise<string> {
  const existing = await prisma.tag.findFirst({
    where: { organizationId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId, name } },
    create: { organizationId, name },
    update: {},
    select: { id: true },
  });
  return created.id;
}

export async function tagContact(
  prisma: PrismaService,
  organizationId: string,
  contactId: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    const tagId = await findOrCreateTag(prisma, organizationId, name);
    await prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId } },
      create: { contactId, tagId },
      update: {},
    });
  }
}

export async function tagConversation(
  prisma: PrismaService,
  organizationId: string,
  conversationId: string,
  names: string[],
): Promise<void> {
  for (const name of names) {
    const tagId = await findOrCreateTag(prisma, organizationId, name);
    await prisma.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId, tagId } },
      create: { conversationId, tagId },
      update: {},
    });
  }
}
