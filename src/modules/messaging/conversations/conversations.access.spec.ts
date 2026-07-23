import { NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { ConversationAccessService } from './conversation-access.service';

/**
 * Cobre a guarda compartilhada `assertConversationAccess` — a peça que fecha
 * a classe de bug em que os caminhos de ESCRITA (assign-me, transfer, close,
 * toggleAi, etc.) não checavam atribuição, permitindo que um AGENT "roubasse"
 * pra si uma conversa que a leitura (`findOne`) já negava.
 *
 * A implementação da guarda mora em `ConversationAccessService` (leaf
 * service — ver conversation-access.service.spec.ts pra cobertura exaustiva
 * da matriz de papéis). Aqui montamos uma instância real dela e a injetamos
 * em `ConversationsService`, que só delega — prova a integração de verdade,
 * não um double.
 */
function makeService(conversationFound: unknown) {
  const prisma: any = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversationFound) },
  };
  const conversationAccess = new ConversationAccessService(prisma);
  const svc: ConversationsService = Object.create(ConversationsService.prototype);
  Object.assign(svc, { prisma, conversationAccess });
  return { svc, prisma };
}

describe('ConversationsService.assertConversationAccess', () => {
  it('AGENT + conversa alheia (findFirst não acha nada) → NotFound', async () => {
    const { svc } = makeService(null);
    await expect(
      (svc as any).assertConversationAccess('conv1', 'org1', OrgRole.AGENT, 'agent-u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('AGENT + conversa própria → resolve com a conversa', async () => {
    const conv = { id: 'conv1', assignedToId: 'agent-u1' };
    const { svc } = makeService(conv);
    await expect(
      (svc as any).assertConversationAccess('conv1', 'org1', OrgRole.AGENT, 'agent-u1'),
    ).resolves.toEqual(conv);
  });

  it('AGENT: query inclui assignedToId no where (escopo aplicado)', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await (svc as any).assertConversationAccess('conv1', 'org1', OrgRole.AGENT, 'agent-u1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1', assignedToId: 'agent-u1' },
    });
  });

  it('ADMIN: query NÃO inclui assignedToId (sem barreira de escopo)', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await (svc as any).assertConversationAccess('conv1', 'org1', OrgRole.ADMIN, 'admin-u1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });

  it('OWNER: query NÃO inclui assignedToId (sem barreira de escopo)', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await (svc as any).assertConversationAccess('conv1', 'org1', OrgRole.OWNER, 'owner-u1');
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });

  it('role indefinido + currentUserId presente → falha fechado (escopa como AGENT)', async () => {
    const { svc, prisma } = makeService(null);
    await expect(
      (svc as any).assertConversationAccess('conv1', 'org1', undefined, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1', assignedToId: 'u1' },
    });
  });

  it('sem currentUserId (chamador de sistema) → sem barreira de escopo', async () => {
    const { svc, prisma } = makeService({ id: 'conv1' });
    await (svc as any).assertConversationAccess('conv1', 'org1', OrgRole.AGENT, undefined);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });
});

describe('ConversationsService.assignToMe — AGENT não reivindica conversa alheia', () => {
  it('rejeita com NotFound quando a conversa não é do AGENT (self-claim impossível)', async () => {
    const { svc, prisma } = makeService(null);
    const fsm = { assign: jest.fn() };
    const repository = { findById: jest.fn() };
    Object.assign(svc as any, { fsm, repository });

    await expect(
      svc.assignToMe('conv1', 'org1', 'agent-u1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fsm.assign).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1', assignedToId: 'agent-u1' },
    });
  });
});

describe('ConversationsService.transfer — AGENT não mexe em conversa alheia', () => {
  it('rejeita com NotFound antes de qualquer efeito colateral', async () => {
    const { svc, prisma } = makeService(null);
    const fsm = { assign: jest.fn() };
    const repository = { findById: jest.fn() };
    Object.assign(svc as any, { fsm, repository });

    await expect(
      svc.transfer('conv1', 'org1', 'agent-new', 'agent-u1', undefined, 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fsm.assign).not.toHaveBeenCalled();
    expect(prisma.message?.create).toBeUndefined();
  });
});

describe('ConversationsService.close — AGENT não fecha conversa alheia', () => {
  it('rejeita com NotFound antes de transicionar o FSM', async () => {
    const { svc } = makeService(null);
    const fsm = { transition: jest.fn() };
    const scheduled = { cancelPendingForConversation: jest.fn() };
    Object.assign(svc as any, { fsm, scheduled });

    await expect(
      svc.close('conv1', 'org1', 'agent-u1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fsm.transition).not.toHaveBeenCalled();
  });
});
