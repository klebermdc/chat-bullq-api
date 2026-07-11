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

  it('ignora o bloco <think> do modelo reasoning (com rascunho) e usa o JSON final', async () => {
    const content =
      '<think>\nVou analisar. Rascunho: {"adults": 9, "children": 9}\nDeixa eu revisar as datas...\n</think>\n' +
      VALID_JSON;
    const service = new ExtractionService(makeLlm(content));
    const out = await service.extract('org-1', 'texto');
    // usa o JSON de verdade (adults 3), não o rascunho de dentro do <think> (9)
    expect(out.adults).toBe(3);
    expect(out.children).toBe(0);
  });

  it('descarta <think> sem fechamento (resposta truncada no raciocínio)', async () => {
    const truncated =
      '<think> Vou analisar o carrinho. 1. Adultos: 6 2. Datas: 10/08 até 14/08 3. Universal';
    const service = new ExtractionService(makeLlm(truncated));
    await expect(service.extract('org-1', 'texto')).rejects.toThrow(
      /não foi possível ler o carrinho/i,
    );
  });

  it('repara vírgula pendurada antes de } ou ]', async () => {
    const withTrailingCommas =
      '{"adults":3,"children":1,"startDate":"2026-07-29","endDate":"2026-08-04",' +
      '"parks":[{"nome":"DISNEY 4 PARKS","dias":4,"data":"2026-07-29"},],' +
      '"totalValue":10000.38,"currency":"BRL",}';
    const service = new ExtractionService(makeLlm(withTrailingCommas));
    const out = await service.extract('org-1', 'texto');
    expect(out.adults).toBe(3);
    expect(out.children).toBe(1);
    expect(out.parks).toHaveLength(1);
    expect(out.totalValue).toBe(10000.38);
  });

  it('faz retry e usa a 2ª resposta quando a 1ª vem inválida', async () => {
    const llm = {
      complete: jest
        .fn()
        .mockResolvedValueOnce({ message: { content: 'desculpe, não sei' } })
        .mockResolvedValueOnce({ message: { content: VALID_JSON } }),
    } as any;
    const service = new ExtractionService(llm);
    const out = await service.extract('org-1', 'texto');
    expect(out.adults).toBe(3);
    expect(llm.complete).toHaveBeenCalledTimes(2);
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
