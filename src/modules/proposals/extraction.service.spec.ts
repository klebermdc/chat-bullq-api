import { ExtractionService } from './extraction.service';

const VALID_JSON = JSON.stringify({
  adults: 3,
  children: 0,
  startDate: '2026-10-02',
  endDate: '2026-10-06',
  parks: [
    {
      nome: 'UNIVERSAL ORLANDO RESORT: UNIVERSAL ORLANDO PROMOCIONAL 3 DIAS PARK TO PARK - GANHE 2 DIAS GRÁTIS',
      dias: 5,
      data: '2026-10-02',
    },
  ],
  totalValue: 4200.5,
  currency: 'BRL',
});

function makeLlm(content: string) {
  return { complete: jest.fn().mockResolvedValue({ message: { content } }) } as any;
}

describe('ExtractionService', () => {
  it('extrai os campos do carrinho a partir do texto renderizado', async () => {
    const service = new ExtractionService(makeLlm(VALID_JSON));
    const out = await service.extract('org-1', 'TEXTO RENDERIZADO DO CARRINHO');
    expect(out.adults).toBe(3);
    expect(out.children).toBe(0);
    expect(out.startDate).toBe('2026-10-02');
    expect(out.parks).toHaveLength(1);
    expect(out.parks[0].dias).toBe(5);
    expect(out.totalValue).toBe(4200.5);
    expect(out.currency).toBe('BRL');
  });

  it('aceita JSON embrulhado em code fence', async () => {
    const service = new ExtractionService(makeLlm('```json\n' + VALID_JSON + '\n```'));
    const out = await service.extract('org-1', 'texto');
    expect(out.adults).toBe(3);
  });

  it('lança erro quando faltam campos obrigatórios', async () => {
    const service = new ExtractionService(makeLlm(JSON.stringify({ adults: 2 })));
    await expect(service.extract('org-1', 'texto')).rejects.toThrow(
      /não foi possível ler o carrinho/i,
    );
  });

  it('lança erro quando a resposta não é JSON', async () => {
    const service = new ExtractionService(makeLlm('desculpe, não sei'));
    await expect(service.extract('org-1', 'texto')).rejects.toThrow(
      /não foi possível ler o carrinho/i,
    );
  });
});
