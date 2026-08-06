import { normalizeCategories, normalizeSupplier, parsePurchaseDate } from './hub-normalize.util';

describe('normalizeCategories', () => {
  it('singulariza o plural — Ingresso e Ingressos são a mesma coisa', () => {
    expect(normalizeCategories('Ingresso')).toEqual(['ingresso']);
    expect(normalizeCategories('Ingressos')).toEqual(['ingresso']);
    expect(normalizeCategories('Seguros')).toEqual(['seguro']);
  });

  it('quebra categoria composta em duas — não inventa uma terceira', () => {
    expect(normalizeCategories('Ingresso e Hotel').sort()).toEqual(['hotel', 'ingresso']);
    expect(normalizeCategories('Ingressos e Hotel').sort()).toEqual(['hotel', 'ingresso']);
  });

  it('reconhece as demais categorias reais da base', () => {
    expect(normalizeCategories('Guiamento')).toEqual(['guiamento']);
    expect(normalizeCategories('Hotel')).toEqual(['hotel']);
    expect(normalizeCategories('Carro')).toEqual(['carro']);
  });

  it('devolve vazio para nulo, vazio ou só espaço', () => {
    expect(normalizeCategories(null)).toEqual([]);
    expect(normalizeCategories('')).toEqual([]);
    expect(normalizeCategories('   ')).toEqual([]);
  });

  it('preserva categoria desconhecida em minúsculo, em vez de descartar', () => {
    // Descartar esconderia produto novo do HUB. Melhor aparecer como está.
    expect(normalizeCategories('Up Grade')).toEqual(['up grade']);
  });
});

describe('normalizeSupplier', () => {
  it('minusculiza e apara', () => {
    expect(normalizeSupplier(' Just Travel ')).toBe('just travel');
  });

  it('trata marcador de vazio como ausente', () => {
    expect(normalizeSupplier('-')).toBeNull();
    expect(normalizeSupplier('')).toBeNull();
    expect(normalizeSupplier(null)).toBeNull();
  });
});

describe('parsePurchaseDate', () => {
  it('aceita data real', () => {
    const d = parsePurchaseDate(new Date('2026-03-15'));
    expect(d?.getFullYear()).toBe(2026);
  });

  it('descarta o marco zero do Unix — é data vazia convertida, não compra de 1969', () => {
    expect(parsePurchaseDate(new Date('1969-12-31'))).toBeNull();
    expect(parsePurchaseDate(new Date('1970-01-01'))).toBeNull();
  });

  it('descarta qualquer coisa anterior a 1990', () => {
    expect(parsePurchaseDate(new Date('1985-06-01'))).toBeNull();
  });

  it('devolve nulo para nulo e para data inválida', () => {
    expect(parsePurchaseDate(null)).toBeNull();
    expect(parsePurchaseDate(new Date('coisa'))).toBeNull();
  });
});
