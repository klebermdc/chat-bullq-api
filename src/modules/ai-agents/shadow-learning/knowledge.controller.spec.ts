import { KnowledgeController } from './knowledge.controller';

describe('KnowledgeController', () => {
  const makeService = () => ({ list: jest.fn().mockResolvedValue([{ id: 'k1' }]) } as any);
  const makeScan = () => ({ scan: jest.fn().mockResolvedValue({ enqueued: 3 }) } as any);

  it('list delega para o service com org e agentId', async () => {
    const service = makeService();
    const ctrl = new KnowledgeController(service, makeScan());
    const r = await ctrl.list('org1', 'a1');
    expect(service.list).toHaveBeenCalledWith('org1', 'a1');
    expect(r).toEqual([{ id: 'k1' }]);
  });

  it('scanHistory delega para o historyScan', async () => {
    const scan = makeScan();
    const ctrl = new KnowledgeController(makeService(), scan);
    const r = await ctrl.scanHistory('org1', 'a1');
    expect(scan.scan).toHaveBeenCalledWith('org1', 'a1');
    expect(r).toEqual({ enqueued: 3 });
  });

  it('import delega para importCurated', async () => {
    const service = { list: jest.fn(), importCurated: jest.fn().mockResolvedValue({ imported: 3, skipped: 1 }) } as any;
    const ctrl = new KnowledgeController(service, { scan: jest.fn() } as any);
    const dto = { items: [{ question: 'q', content: 'a', category: 'faq-geral' }] } as any;
    const r = await ctrl.import('org1', 'a1', dto);
    expect(service.importCurated).toHaveBeenCalledWith('org1', 'a1', dto.items);
    expect(r).toEqual({ imported: 3, skipped: 1 });
  });
});
