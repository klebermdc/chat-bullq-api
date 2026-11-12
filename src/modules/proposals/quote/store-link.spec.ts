import { BadRequestException } from '@nestjs/common';
import { isStoreCartLink, STORE_LINK_MAX, storeLinkOrNull } from './store-link';

describe('isStoreCartLink', () => {
  it('aceita o carrinho da loja em qualquer idioma de 2 letras', () => {
    expect(isStoreCartLink('https://reservas.orlandofastpass.com.br/pt/checkout/ce6098a7')).toBe(true);
    expect(isStoreCartLink('https://reservas.orlandofastpass.com.br/es/checkout/ce6098a7')).toBe(true);
  });

  it.each([
    'http://reservas.orlandofastpass.com.br/pt/checkout/abc',
    'https://reservas.orlandofastpass.com.br.evil.com/pt/checkout/abc',
    'https://evil.com/?https://reservas.orlandofastpass.com.br/pt/checkout/abc',
    'https://reservas.orlandofastpass.com.br/pt/checkout/abc#frag',
    'https://reservas.orlandofastpass.com.br/pt/checkout/../../admin',
    ' https://reservas.orlandofastpass.com.br/pt/checkout/abc',
  ])('recusa %s', (link) => {
    expect(isStoreCartLink(link)).toBe(false);
  });

  it('recusa o que não é texto e o que passa do limite', () => {
    expect(isStoreCartLink(undefined)).toBe(false);
    expect(isStoreCartLink(42)).toBe(false);
    const long = `https://reservas.orlandofastpass.com.br/pt/checkout/${'a'.repeat(STORE_LINK_MAX)}`;
    expect(isStoreCartLink(long)).toBe(false);
  });
});

describe('storeLinkOrNull', () => {
  it('ausente vira null; link da loja passa como veio', () => {
    const link = 'https://reservas.orlandofastpass.com.br/pt/checkout/ce6098a7';

    expect(storeLinkOrNull(undefined)).toBeNull();
    expect(storeLinkOrNull(null)).toBeNull();
    expect(storeLinkOrNull(link)).toBe(link);
  });

  it.each(['', 'https://evil.com/pt/checkout/abc', 7])('recusa %p com 400', (value) => {
    expect(() => storeLinkOrNull(value)).toThrow(BadRequestException);
  });
});
