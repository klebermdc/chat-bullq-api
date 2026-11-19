import { orderNumberCandidates } from './order-number';

describe('orderNumberCandidates', () => {
  it('vazio ou só espaço → nenhum candidato', () => {
    expect(orderNumberCandidates('')).toEqual([]);
    expect(orderNumberCandidates('   ')).toEqual([]);
    expect(orderNumberCandidates(null)).toEqual([]);
  });

  it('mantém o texto inteiro (match exato de antes)', () => {
    expect(orderNumberCandidates('R4YB7P')).toEqual(['R4YB7P']);
  });

  it('extrai o localizador de "Localizador: R4YB7P"', () => {
    expect(orderNumberCandidates('Localizador: R4YB7P')).toContain('R4YB7P');
  });

  it('extrai o nº de "PEDIDO 78516 just" e "79045 JT"', () => {
    expect(orderNumberCandidates('PEDIDO 78516 just')).toContain('78516');
    expect(orderNumberCandidates('79045 JT')).toContain('79045');
  });

  it('extrai o localizador colado em "AZUL Localizador:2NM617"', () => {
    expect(orderNumberCandidates('AZUL Localizador:2NM617')).toContain('2NM617');
  });

  it('nunca gera "GUIA" (pedido genérico do HUB) nem pedaços curtos', () => {
    const candidates = orderNumberCandidates('Fechou guia JT 1');
    expect(candidates).not.toContain('GUIA');
    expect(candidates).not.toContain('JT');
    expect(candidates).not.toContain('1');
  });
});
