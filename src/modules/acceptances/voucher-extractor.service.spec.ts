import { VoucherExtractorService } from './voucher-extractor.service';

function llmReturning(text: string) {
  return { complete: jest.fn().mockResolvedValue({ message: { content: text } }) } as any;
}

describe('VoucherExtractorService', () => {
  it('extrai itens e o nº do pedido do JSON do modelo', async () => {
    const llm = llmReturning(
      JSON.stringify({
        orderRef: '61293',
        items: [
          {
            description: 'Magic Kingdom - 1 dia',
            qty: 3,
            date: '12/09/2026',
            ref: 'JTT-8842-XK',
            note: 'Válido até 31/12/2026. Não reembolsável.',
          },
        ],
      }),
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto do voucher', 'org-1');

    expect(out.orderRef).toBe('61293');
    expect(out.items).toEqual([
      {
        description: 'Magic Kingdom - 1 dia',
        qty: 3,
        date: '12/09/2026',
        ref: 'JTT-8842-XK',
        note: 'Válido até 31/12/2026. Não reembolsável.',
      },
    ]);
  });

  it('descarta bloco <think> antes de parsear', async () => {
    const llm = llmReturning(
      '<think>deixa eu pensar</think>{"orderRef":null,"items":[{"description":"Ingresso"}]}',
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto', 'org-1');

    expect(out.items).toEqual([{ description: 'Ingresso' }]);
    expect(out.orderRef).toBeNull();
  });

  it('descarta item sem descrição em vez de propagar lixo', async () => {
    const llm = llmReturning(
      JSON.stringify({ items: [{ qty: 2 }, { description: '   ' }, { description: 'Ok' }] }),
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto', 'org-1');

    expect(out.items).toEqual([{ description: 'Ok' }]);
  });

  it('devolve vazio quando o LLM falha, sem estourar', async () => {
    const llm = { complete: jest.fn().mockRejectedValue(new Error('502')) } as any;
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('texto', 'org-1');

    expect(out).toEqual({ items: [], orderRef: null });
  });

  describe('passageiros', () => {
    it('extrai os passageiros com nome e nascimento', async () => {
      const llm = llmReturning(
        JSON.stringify({
          orderRef: null,
          items: [
            {
              description: 'WALT DISNEY WORLD - INGRESSO 1 DIA EPCOT',
              qty: 3,
              date: '14/09/2026',
              passengers: [
                { name: 'Rodolpho Carvalho Costa da Rocha', birthDate: '07/11/1988' },
                { name: 'Laura Géssica Dantas da Silva Rocha', birthDate: '12/08/1991' },
                { name: 'Maria Helena Dantas Carvalho da Rocha', birthDate: '20/04/2020' },
              ],
            },
          ],
        }),
      );
      const svc = new VoucherExtractorService(llm);

      const out = await svc.extract('texto do voucher', 'org-1');

      expect(out.items[0].passengers).toEqual([
        { name: 'Rodolpho Carvalho Costa da Rocha', birthDate: '07/11/1988' },
        { name: 'Laura Géssica Dantas da Silva Rocha', birthDate: '12/08/1991' },
        { name: 'Maria Helena Dantas Carvalho da Rocha', birthDate: '20/04/2020' },
      ]);
    });

    it('aceita passageiro sem nascimento (campo ausente é omitido, não chutado)', async () => {
      const llm = llmReturning(
        JSON.stringify({
          items: [{ description: 'Ingresso', passengers: [{ name: 'Ana Souza' }] }],
        }),
      );
      const svc = new VoucherExtractorService(llm);

      const out = await svc.extract('texto', 'org-1');

      expect(out.items[0].passengers).toEqual([{ name: 'Ana Souza' }]);
      expect(out.items[0].passengers![0]).not.toHaveProperty('birthDate');
    });

    // Uma linha em branco na lista de passageiros do comprovante vira discussão
    // no portão do parque. Melhor o nome não aparecer do que aparecer vazio.
    it('descarta passageiro sem nome utilizável em vez de propagar lixo', async () => {
      const llm = llmReturning(
        JSON.stringify({
          items: [
            {
              description: 'Ingresso',
              passengers: [
                { birthDate: '07/11/1988' },
                { name: '   ' },
                { name: 42 },
                null,
                'Fulano',
                { name: 'Ana Souza' },
              ],
            },
          ],
        }),
      );
      const svc = new VoucherExtractorService(llm);

      const out = await svc.extract('texto', 'org-1');

      expect(out.items[0].passengers).toEqual([{ name: 'Ana Souza' }]);
    });

    it('ignora nascimento que não veio como string', async () => {
      const llm = llmReturning(
        JSON.stringify({
          items: [
            { description: 'Ingresso', passengers: [{ name: 'Ana', birthDate: 1988 }] },
          ],
        }),
      );
      const svc = new VoucherExtractorService(llm);

      const out = await svc.extract('texto', 'org-1');

      expect(out.items[0].passengers).toEqual([{ name: 'Ana' }]);
    });

    it('omite o campo quando não há passageiro nenhum (nem lista vazia)', async () => {
      const llm = llmReturning(
        JSON.stringify({
          items: [
            { description: 'Sem lista' },
            { description: 'Lista vazia', passengers: [] },
            { description: 'Lista inválida', passengers: 'Ana e João' },
            { description: 'Só lixo', passengers: [{ birthDate: '07/11/1988' }] },
          ],
        }),
      );
      const svc = new VoucherExtractorService(llm);

      const out = await svc.extract('texto', 'org-1');

      for (const item of out.items) expect(item).not.toHaveProperty('passengers');
    });

    // `qty` e `passengers` são independentes: reconciliar seria deduzir, e o
    // extrator inteiro existe para NÃO deduzir.
    it('não reconcilia qty com o número de nomes listados', async () => {
      const llm = llmReturning(
        JSON.stringify({
          items: [
            {
              description: 'Ingresso',
              qty: 2,
              passengers: [{ name: 'Ana' }, { name: 'João' }, { name: 'Maria' }],
            },
          ],
        }),
      );
      const svc = new VoucherExtractorService(llm);

      const out = await svc.extract('texto', 'org-1');

      expect(out.items[0].qty).toBe(2);
      expect(out.items[0].passengers).toHaveLength(3);
    });

    it('pede os passageiros no prompt e proíbe inventar nome', async () => {
      const llm = llmReturning('{"items":[]}');
      const svc = new VoucherExtractorService(llm);

      await svc.extract('texto', 'org-1');

      const prompt = llm.complete.mock.calls[0][0].messages[0].content[0].text;
      expect(prompt).toContain('passengers');
      expect(prompt).toMatch(/NUNCA invente um nome/i);
    });
  });

  it('nem chama o LLM quando o texto está vazio', async () => {
    const llm = llmReturning('{}');
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('   ', 'org-1');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(out).toEqual({ items: [], orderRef: null });
  });
});

describe('VoucherExtractorService.extractFromImages', () => {
  const png = (b: string) => Buffer.from(b);

  it('manda uma parte de imagem base64 por página, sem prefixo data:', async () => {
    const llm = llmReturning('{"orderRef":"61293","items":[{"description":"Magic Kingdom"}]}');
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extractFromImages([png('pagina-1'), png('pagina-2')], 'org-1');

    const req = llm.complete.mock.calls[0][0];
    const parts = req.messages[1].content;
    expect(parts[0].type).toBe('text');
    expect(parts.slice(1)).toEqual([
      { type: 'image', base64: { mediaType: 'image/png', data: png('pagina-1').toString('base64') } },
      { type: 'image', base64: { mediaType: 'image/png', data: png('pagina-2').toString('base64') } },
    ]);
    // O `data` vai cru: quem monta o `data:image/png;base64,` é o LlmService.
    expect(parts[1].base64.data).not.toMatch(/^data:/);
    expect(out).toEqual({ orderRef: '61293', items: [{ description: 'Magic Kingdom' }] });
  });

  it('usa o MESMO prompt grounded e temperatura 0 do caminho de texto', async () => {
    // Um voucher lido errado por visão erra a data do parque igual a um lido
    // errado por texto — as regras não podem afrouxar por causa do formato.
    const llm = llmReturning('{"items":[]}');
    const svc = new VoucherExtractorService(llm);

    await svc.extractFromImages([png('x')], 'org-1');
    await svc.extract('texto do voucher', 'org-1');

    const [visao, texto] = llm.complete.mock.calls.map((c: any[]) => c[0]);
    expect(visao.messages[0]).toEqual(texto.messages[0]);
    expect(visao.messages[0].content[0].text).toContain('NUNCA invente ou deduza');
    expect(visao.temperature).toBe(0);
    expect(visao.modelId).toBe(texto.modelId);
  });

  it('devolve vazio quando o LLM falha, sem estourar', async () => {
    const llm = { complete: jest.fn().mockRejectedValue(new Error('502')) } as any;
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extractFromImages([png('x')], 'org-1');

    expect(out).toEqual({ items: [], orderRef: null });
  });

  it('aplica o mesmo parse tolerante (descarta <think> e item sem descrição)', async () => {
    const llm = llmReturning(
      '<think>hmm</think>{"items":[{"qty":2},{"description":"Ingresso"}]}',
    );
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extractFromImages([png('x')], 'org-1');

    expect(out).toEqual({ items: [{ description: 'Ingresso' }], orderRef: null });
  });

  it('nem chama o LLM quando não há páginas rasterizadas', async () => {
    const llm = llmReturning('{}');
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extractFromImages([], 'org-1');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(out).toEqual({ items: [], orderRef: null });
  });
});
