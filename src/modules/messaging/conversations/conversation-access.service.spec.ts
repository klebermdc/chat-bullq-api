import { NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ConversationAccessService } from './conversation-access.service';

/**
 * Cobre a guarda `assertConversationAccess` diretamente na sua casa (leaf
 * service, só PrismaService) — extraída de `ConversationsService` pra evitar
 * o ciclo de DI que injetar o service inteiro causava em outros módulos
 * (calls, proposals, scheduled-messages, messages). Matriz de papéis igual
 * à que vivia em conversations.access.spec.ts antes da extração.
 */
function makeService(conversationFound: unknown) {
  const prisma: any = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversationFound) },
  };
  const svc = new ConversationAccessService(prisma);
  return { svc, prisma };
}

describe('ConversationAccessService.assertConversationAccess', () => {
  it('AGENT + conversa alheia (findFirst não acha nada) → NotFound', async () => {
    const { svc } = makeService(null);
    await expect(
      svc.assertConversationAccess('conv1', 'org1', OrgRole.AGENT, 'agent-u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('AGENT + conversa própria → resolve com a conversa', async () => {
    const conv = { id: 'conv1', assignedToId: 'agent-u1' };
    const { svc } = makeService(conv);
    await expect(
      svc.assertConversationAccess('conv1', 'org1', OrgRole.AGENT, 'agent-u1'),
    ).resolves.toEqual(conv);
  });

  it('AGENT: query inclui assignedToId no where (escopo aplicado)', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await svc.assertConversationAccess('conv1', 'org1', OrgRole.AGENT, 'agent-u1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1', assignedToId: 'agent-u1' },
    });
  });

  it('ADMIN: query NÃO inclui assignedToId (sem barreira de escopo)', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await svc.assertConversationAccess('conv1', 'org1', OrgRole.ADMIN, 'admin-u1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });

  it('OWNER: query NÃO inclui assignedToId (sem barreira de escopo)', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await svc.assertConversationAccess('conv1', 'org1', OrgRole.OWNER, 'owner-u1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });

  it('role indefinido + currentUserId presente → falha fechado (escopa como AGENT)', async () => {
    const { svc, prisma } = makeService(null);
    await expect(
      svc.assertConversationAccess('conv1', 'org1', undefined, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1', assignedToId: 'u1' },
    });
  });

  it('sem currentUserId (chamador de sistema) → sem barreira de escopo', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await svc.assertConversationAccess('conv1', 'org1', OrgRole.AGENT, undefined);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });
});
