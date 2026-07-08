import { KnowledgeController } from './knowledge.controller';

describe('KnowledgeController.list', () => {
  it('delega para o service com org do request e agentId do param', async () => {
    const service = { list: jest.fn().mockResolvedValue([{ id: 'k1' }]) } as any;
    const ctrl = new KnowledgeController(service);
    const r = await ctrl.list('org1', 'a1');
    expect(service.list).toHaveBeenCalledWith('org1', 'a1');
    expect(r).toEqual([{ id: 'k1' }]);
  });
});
