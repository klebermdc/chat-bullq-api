import { KnowledgeExtractorProcessor } from './knowledge-extractor.processor';

describe('KnowledgeExtractorProcessor.process', () => {
  function make() {
    const prisma = {
      message: {
        // findMany é chamado com orderBy createdAt desc (newest first) —
        // igual ao molde memory-extractor.processor. Depois de .reverse()
        // vira ordem cronológica: INBOUND (10:00) → OUTBOUND (10:01).
        // Message.content é coluna Json, então usamos o shape { text }.
        findMany: jest.fn().mockResolvedValue([
          {
            direction: 'OUTBOUND',
            content: { text: 'reemite no app' },
            createdAt: new Date('2026-07-08T10:01:00Z'),
          },
          {
            direction: 'INBOUND',
            content: { text: 'perdi o fast pass' },
            createdAt: new Date('2026-07-08T10:00:00Z'),
          },
        ]),
      },
    } as any;
    const extractor = {
      extract: jest.fn().mockResolvedValue({
        items: [{ kind: 'qa', category: 'fast-pass', content: 'reemite no app' }],
        reasoning: null,
      }),
    } as any;
    const knowledge = { recordItems: jest.fn().mockResolvedValue(undefined) } as any;
    const proc = new KnowledgeExtractorProcessor(prisma, extractor, knowledge);
    return { proc, prisma, extractor, knowledge };
  }

  it('puxa mensagens, mapeia papéis, extrai e grava conhecimento', async () => {
    const { proc, extractor, knowledge } = make();
    await proc.process({
      data: { organizationId: 'org1', agentId: 'a1', conversationId: 'c1' },
    } as any);

    const passedInput = extractor.extract.mock.calls[0][0];
    expect(passedInput.messages[0]).toMatchObject({ role: 'customer' });
    expect(passedInput.messages[1]).toMatchObject({ role: 'operator' });
    expect(knowledge.recordItems).toHaveBeenCalledWith(
      'org1',
      'a1',
      expect.any(Array),
      { conversationId: 'c1' },
    );
  });
});
