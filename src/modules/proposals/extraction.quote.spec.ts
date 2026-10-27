import { ExtractionService } from './extraction.service';

const QUOTE_JSON = JSON.stringify({
  items: [
    {
      provider: 'Universal Orlando Resort',
      title: 'Universal 2 Park 3 Days',
      startDate: '2026-12-10',
      endDate: '2026-12-12',
      description: null,
      adults: 2,
      children: 0,
      priceAdult: null,
      priceChild: null,
      total: 9000,
      cancellationPolicy: null,
    },
  ],
  currency: 'BRL',
  total: 9000,
  pixTotal: null,
  installments: null,
});

const image = { mediaType: 'image/png', data: 'AAAA' };

function makeLlm(...contents: string[]) {
  const complete = jest.fn();
  contents.forEach((c) => complete.mockResolvedValueOnce({ message: { content: c } }));
  return { complete } as any;
}

describe('ExtractionService.extractQuoteFromImages', () => {
  it('usa o prompt NOVO de cotação, modelo de visão, temperatura 0 e as imagens em base64', async () => {
    const llm = makeLlm(QUOTE_JSON);
    const service = new ExtractionService(llm);

    const out = await service.extractQuoteFromImages('org-1', { images: [image], pastedText: 'obs' });

    expect(out.total).toBe(9000);
    expect(out.items[0].title).toBe('Universal 2 Park 3 Days');
    const call = llm.complete.mock.calls[0][0];
    expect(call.temperature).toBe(0);
    expect(call.messages[0].content).toMatch(/COTAÇÃO/);
    expect(call.messages[0].content).toMatch(/CPF/);
    const parts = call.messages[1].content;
    expect(parts).toEqual(
      expect.arrayContaining([{ type: 'image', base64: { mediaType: 'image/png', data: 'AAAA' } }]),
    );
    expect(parts[0].text).toContain('<<<RESUMO>>>\nobs');
  });

  it('o prompt de cotação não é nenhum dos prompts antigos', async () => {
    const quoteLlm = makeLlm(QUOTE_JSON);
    await new ExtractionService(quoteLlm).extractQuoteFromImages('org-1', { images: [image] });
    const visionLlm = makeLlm(JSON.stringify({ kind: 'OTHER', title: 'Carro', lines: ['x'], totalValue: 1, currency: 'BRL' }));
    await new ExtractionService(visionLlm).extractFromImages('org-1', { images: [image] });

    expect(quoteLlm.complete.mock.calls[0][0].messages[0].content).not.toBe(
      visionLlm.complete.mock.calls[0][0].messages[0].content,
    );
  });

  it('tenta de novo quando o modelo responde ilegível e falha depois de 3', async () => {
    const unreadable = JSON.stringify({ kind: 'UNREADABLE' });
    const llm = makeLlm(unreadable, unreadable, unreadable);

    await expect(
      new ExtractionService(llm).extractQuoteFromImages('org-1', { images: [image] }),
    ).rejects.toThrow(/ler/);
    expect(llm.complete).toHaveBeenCalledTimes(3);
  });
});
