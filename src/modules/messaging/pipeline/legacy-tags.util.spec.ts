import { parseLegacyTags } from './legacy-tags.util';

describe('parseLegacyTags', () => {
  it('separa várias etiquetas por "|" e tira espaços', () => {
    expect(parseLegacyTags('Halloween Disney | URGENTE')).toEqual([
      'Halloween Disney',
      'URGENTE',
    ]);
  });

  it('devolve lista vazia para célula vazia ou nula', () => {
    expect(parseLegacyTags(null)).toEqual([]);
    expect(parseLegacyTags('')).toEqual([]);
    expect(parseLegacyTags('  |  ')).toEqual([]);
  });

  it('remove repetidas ignorando maiúsculas, mantendo a primeira grafia', () => {
    expect(parseLegacyTags('Guia | GUIA | CRM')).toEqual(['Guia', 'CRM']);
  });
});
