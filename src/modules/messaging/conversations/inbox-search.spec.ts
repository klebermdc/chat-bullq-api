import { buildSearchOr } from './inbox-search';

describe('buildSearchOr', () => {
  it('termo vazio não restringe nada', () => {
    expect(buildSearchOr('  ', ['c1'])).toEqual([]);
  });

  it('casa as conversas dos contatos encontrados ou o protocolo', () => {
    expect(buildSearchOr('Maria', ['c1', 'c2'])).toEqual([
      { contactId: { in: ['c1', 'c2'] } },
      { protocol: { contains: 'Maria', mode: 'insensitive' } },
    ]);
  });

  it('sem contato encontrado ainda procura pelo protocolo', () => {
    expect(buildSearchOr('A1B2', [])).toEqual([
      { protocol: { contains: 'A1B2', mode: 'insensitive' } },
    ]);
  });
});
