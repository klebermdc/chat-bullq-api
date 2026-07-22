import { OrgRole } from '@prisma/client';
import { OrderFichaController } from './order-ficha.controller';

function makeController(opts: {
  ficha?: unknown;
  conversationFound?: unknown;
}) {
  const repo = {
    findByConversation: jest.fn().mockResolvedValue(opts.ficha ?? null),
  } as any;
  const prisma = {
    conversation: {
      findFirst: jest.fn().mockResolvedValue(opts.conversationFound ?? null),
    },
  } as any;
  const ctrl = new OrderFichaController(repo, prisma);
  return { ctrl, repo, prisma };
}

describe('OrderFichaController', () => {
  it('retorna a ficha da conversa', async () => {
    const { ctrl, repo } = makeController({ ficha: { id: 'f1', items: [] } });
    const out = await ctrl.getForConversation('cv1');
    expect(out).toEqual({ id: 'f1', items: [] });
    expect(repo.findByConversation).toHaveBeenCalledWith('cv1');
  });

  it('não retorna ficha de outra organização (org-scope)', async () => {
    const { ctrl } = makeController({
      ficha: { id: 'f2', organizationId: 'org-a', items: [] },
    });
    const out = await ctrl.getForConversation('cv2', 'org-b');
    expect(out).toBeNull();
  });

  it('retorna a ficha quando organizationId bate com o org do usuário (sem role/userId — chamador não escopado)', async () => {
    const { ctrl } = makeController({
      ficha: { id: 'f3', organizationId: 'org-a', items: [] },
    });
    const out = await ctrl.getForConversation('cv3', 'org-a');
    expect(out).toEqual({ id: 'f3', organizationId: 'org-a', items: [] });
  });
});

describe('OrderFichaController.getForConversation — escopo por atribuição', () => {
  const ficha = { id: 'f1', organizationId: 'org-a', items: [] };

  it('AGENT com conversa alheia recebe null', async () => {
    const { ctrl, prisma } = makeController({ ficha, conversationFound: null });
    const out = await ctrl.getForConversation('cv1', 'org-a', OrgRole.AGENT, 'agent-u1');
    expect(out).toBeNull();
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'cv1', organizationId: 'org-a', assignedToId: 'agent-u1' },
      select: { id: true },
    });
  });

  it('AGENT com conversa própria recebe a ficha', async () => {
    const { ctrl } = makeController({ ficha, conversationFound: { id: 'cv1' } });
    const out = await ctrl.getForConversation('cv1', 'org-a', OrgRole.AGENT, 'agent-u1');
    expect(out).toEqual(ficha);
  });

  it('ADMIN não é escopado (não consulta conversation.findFirst)', async () => {
    const { ctrl, prisma } = makeController({ ficha });
    const out = await ctrl.getForConversation('cv1', 'org-a', OrgRole.ADMIN, 'admin-u1');
    expect(out).toEqual(ficha);
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});
