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

  it('nem chama o LLM quando o texto está vazio', async () => {
    const llm = llmReturning('{}');
    const svc = new VoucherExtractorService(llm);

    const out = await svc.extract('   ', 'org-1');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(out).toEqual({ items: [], orderRef: null });
  });
});
