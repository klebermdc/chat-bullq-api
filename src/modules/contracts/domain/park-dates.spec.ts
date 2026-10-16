import { formatParkDates, readContractDates } from './park-dates';

describe('formatParkDates', () => {
  it('gera linhas "dd/MM/yyyy - Parque" em ordem de data', () => {
    expect(
      formatParkDates([
        { parkId: 'epcot', date: '2026-12-02' },
        { parkId: 'magic-kingdom', date: '2026-12-01' },
      ]),
    ).toBe('01/12/2026 - Magic Kingdom\n02/12/2026 - EPCOT');
  });

  it('vazio vira "Datas a definir"', () => {
    expect(formatParkDates([])).toBe('Datas a definir');
  });
});

describe('readContractDates', () => {
  const createdAt = new Date('2026-10-15T12:00:00Z');

  it('usa parkDates quando existe', () => {
    expect(
      readContractDates({ parkDates: [{ parkId: 'epcot', date: '2027-01-05' }], requestedDates: 'x', createdAt }),
    ).toEqual([{ parkId: 'epcot', label: 'EPCOT', date: '2027-01-05' }]);
  });

  it('legado sem ano: data antes da criação vira o ano seguinte', () => {
    const out = readContractDates({
      parkDates: [],
      requestedDates: '20/12 - Magic Kingdom\n05/01 - EPCOT',
      createdAt,
    });
    expect(out).toEqual([
      { parkId: 'magic-kingdom', label: 'Magic Kingdom', date: '2026-12-20' },
      { parkId: 'epcot', label: 'EPCOT', date: '2027-01-05' },
    ]);
  });

  it('legado com ano (formato do calendário) é respeitado', () => {
    expect(
      readContractDates({ parkDates: [], requestedDates: '03/02/2026 - Animal Kingdom', createdAt }),
    ).toEqual([{ parkId: 'animal-kingdom', label: 'Animal Kingdom', date: '2026-02-03' }]);
  });

  it('parque desconhecido mantém o rótulo com parkId null', () => {
    expect(readContractDates({ parkDates: [], requestedDates: '01/11 - Volcano Bay', createdAt })).toEqual([
      { parkId: null, label: 'Volcano Bay', date: '2026-11-01' },
    ]);
  });

  it('ignora linhas sem data e "Datas a definir"', () => {
    expect(readContractDates({ parkDates: [], requestedDates: 'Datas a definir', createdAt })).toEqual([]);
  });

  it('data impossível é descartada', () => {
    expect(readContractDates({ parkDates: [], requestedDates: '31/02 - EPCOT', createdAt })).toEqual([]);
  });

  it('ano inferido pelo horário de Brasília (criado 31/12 22h BRT = 01/01 01h UTC)', () => {
    expect(
      readContractDates({
        parkDates: [],
        requestedDates: '28/12 - EPCOT',
        createdAt: new Date('2027-01-01T01:00:00Z'),
      }),
    ).toEqual([{ parkId: 'epcot', label: 'EPCOT', date: '2026-12-28' }]);
  });
});
