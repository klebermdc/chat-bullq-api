import { KnowledgeExtractorService } from './knowledge-extractor.service';

describe('KnowledgeExtractorService.extract', () => {
  function make(llmContent: string) {
    const llm = {
      complete: jest.fn().mockResolvedValue({ message: { content: llmContent } }),
    } as any;
    return { svc: new KnowledgeExtractorService(llm), llm };
  }

  it('destila pares dúvida→resposta do atendente em itens de conhecimento', async () => {
    const json = JSON.stringify({
      items: [
        {
          kind: 'qa',
          category: 'fast-pass',
          question: 'Perdi meu Fast Pass',
          content: 'Oriente a acessar o app e reemitir em Meus Ingressos.',
        },
      ],
      reasoning: 'cliente perguntou, atendente respondeu o procedimento',
    });
    const { svc, llm } = make(json);

    const result = await svc.extract({
      organizationId: 'org1',
      agentId: 'a1',
      conversationId: 'c1',
      messages: [
        { role: 'customer', content: 'Perdi meu Fast Pass', createdAt: '2026-07-08T10:00:00Z' },
        {
          role: 'operator',
          content: 'Acesse o app, em Meus Ingressos você reemite.',
          createdAt: '2026-07-08T10:01:00Z',
        },
      ],
    });

    expect(llm.complete).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'qa', category: 'fast-pass' });
  });

  it('tolera JSON embrulhado em cercas ```json e devolve items vazio em lixo', async () => {
    const { svc } = make('```json\n{"items":[],"reasoning":null}\n```');
    const r = await svc.extract({ organizationId: 'o', agentId: 'a', conversationId: 'c', messages: [] });
    expect(r.items).toEqual([]);

    const { svc: svc2 } = make('desculpa, não entendi');
    const r2 = await svc2.extract({ organizationId: 'o', agentId: 'a', conversationId: 'c', messages: [] });
    expect(r2.items).toEqual([]);
  });
});
