import { OrderFichaController } from './order-ficha.controller';

describe('OrderFichaController', () => {
  const repo = { findByConversation: jest.fn().mockResolvedValue({ id: 'f1', items: [] }) } as any;
  const ctrl = new OrderFichaController(repo);

  it('retorna a ficha da conversa', async () => {
    const out = await ctrl.getForConversation('cv1');
    expect(out).toEqual({ id: 'f1', items: [] });
    expect(repo.findByConversation).toHaveBeenCalledWith('cv1');
  });

  it('não retorna ficha de outra organização (org-scope)', async () => {
    const crossOrgRepo = {
      findByConversation: jest
        .fn()
        .mockResolvedValue({ id: 'f2', organizationId: 'org-a', items: [] }),
    } as any;
    const crossOrgCtrl = new OrderFichaController(crossOrgRepo);

    const out = await crossOrgCtrl.getForConversation('cv2', 'org-b');
    expect(out).toBeNull();
  });

  it('retorna a ficha quando organizationId bate com o org do usuário', async () => {
    const sameOrgRepo = {
      findByConversation: jest
        .fn()
        .mockResolvedValue({ id: 'f3', organizationId: 'org-a', items: [] }),
    } as any;
    const sameOrgCtrl = new OrderFichaController(sameOrgRepo);

    const out = await sameOrgCtrl.getForConversation('cv3', 'org-a');
    expect(out).toEqual({ id: 'f3', organizationId: 'org-a', items: [] });
  });
});
