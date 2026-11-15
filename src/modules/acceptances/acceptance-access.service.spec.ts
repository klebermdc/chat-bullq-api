import { NotFoundException } from '@nestjs/common';
import { AcceptanceAccessService } from './acceptance-access.service';
import { ConversationActor, ConversationGuardService } from './conversation-guard.service';

const AGENT: ConversationActor = { organizationId: 'org-1', role: 'AGENT', userId: 'u-1', channelAccess: new Set(['ch-1']) };

function setup(acc: any, conv: any = { id: 'conv-1', channelId: 'ch-1' }) {
  const prisma = { orderAcceptance: {
    findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
      acc && where.id === acc.id && where.organizationId === acc.organizationId ? { conversationId: acc.conversationId } : null),
  } } as any;
  const conversationAccess = {
    assertConversationAccess: jest.fn().mockImplementation(async () => {
      if (!conv) throw new NotFoundException('Conversation not found');
      return conv;
    }),
  } as any;
  const svc = new AcceptanceAccessService(prisma, new ConversationGuardService(conversationAccess));
  return { svc, conversationAccess };
}

const ACC = { id: 'acc-1', organizationId: 'org-1', conversationId: 'conv-1' };

describe('AcceptanceAccessService', () => {
  it('libera o dono da conversa com acesso ao canal', async () => {
    const { svc, conversationAccess } = setup(ACC);
    await expect(svc.assertAccess(AGENT, 'acc-1')).resolves.toBeUndefined();
    expect(conversationAccess.assertConversationAccess).toHaveBeenCalledWith('conv-1', 'org-1', 'AGENT', 'u-1', { allowParticipant: true });
  });

  it('ADMIN com todos os canais passa', async () => {
    const { svc } = setup(ACC);
    await expect(svc.assertAccess({ ...AGENT, role: 'ADMIN', channelAccess: 'ALL' }, 'acc-1')).resolves.toBeUndefined();
  });

  it('aceite de outra org → 404 sem consultar a conversa', async () => {
    const { svc, conversationAccess } = setup({ ...ACC, organizationId: 'org-2' });
    await expect(svc.assertAccess(AGENT, 'acc-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(conversationAccess.assertConversationAccess).not.toHaveBeenCalled();
  });

  it('conversa de colega (AGENT) → 404', async () => {
    const { svc } = setup(ACC, null);
    await expect(svc.assertAccess(AGENT, 'acc-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('canal sem acesso → 404', async () => {
    const { svc } = setup(ACC);
    await expect(svc.assertAccess({ ...AGENT, channelAccess: new Set(['outro']) }, 'acc-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
