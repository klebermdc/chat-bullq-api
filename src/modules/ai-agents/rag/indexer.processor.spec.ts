import { RagIndexerProcessor } from './indexer.processor';

describe('RagIndexerProcessor.process — index_procedure', () => {
  function make() {
    const embeddings = { embed: jest.fn().mockResolvedValue({ vector: [0.1, 0.2], model: 'm', tokensUsed: 1, costUsd: 0 }) } as any;
    const store = { upsert: jest.fn().mockResolvedValue(undefined) } as any;
    const proc = new RagIndexerProcessor(embeddings, store);
    return { proc, embeddings, store };
  }

  it('indexa um procedimento com ownerType=procedure escopado por agentId', async () => {
    const { proc, embeddings, store } = make();
    await proc.process({
      data: { type: 'index_procedure', knowledgeId: 'k1', content: 'passo a passo X', organizationId: 'org1', agentId: 'a1' },
    } as any);

    expect(embeddings.embed).toHaveBeenCalledWith('passo a passo X', 'org1');
    expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'procedure:k1',
      ownerType: 'procedure',
      ownerId: 'k1',
      agentId: 'a1',
      content: 'passo a passo X',
    }));
  });
});
