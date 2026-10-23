import { containsWrongVisaClaim } from './text-guards';

/**
 * Visto em prod (Sirds, 2026-10-22 16:03): a IA disse que brasileiro não
 * precisa de visto para os EUA, só da ESTA. Errado: o Brasil não está no
 * Visa Waiver Program, então brasileiro precisa de visto B1/B2 e a ESTA não
 * vale para passaporte brasileiro.
 */
describe('containsWrongVisaClaim', () => {
  it('bloqueia as duas mensagens que foram ao cliente', () => {
    expect(
      containsWrongVisaClaim(
        'Em geral, quem tem passaporte brasileiro válido costuma entrar nos EUA sem visto, mas precisa da autorização de viagem (ESTA) registrada no site oficial do governo americano.',
      ),
    ).toBe(true);
    expect(
      containsWrongVisaClaim(
        'Brasileiro com passaporte válido normalmente **não precisa de visto**, mas precisa da **ESTA** (autorização de viagem eletrônica)',
      ),
    ).toBe(true);
  });

  it.each([
    'Você não precisa de visto para ir',
    'brasileiro não precisa mais de visto americano',
    'Hoje dá pra viajar sem visto',
    'Brasil entrou no Visa Waiver',
    'é só tirar a ESTA online',
    'É isento de visto',
    'o visto é dispensado para brasileiros',
  ])('bloqueia "%s"', (text) => {
    expect(containsWrongVisaClaim(text)).toBe(true);
  });

  it.each([
    'Para os EUA, brasileiro precisa do visto americano válido.',
    'Sobre visto, quem te orienta certinho é o consultor.',
    'Esta semana tem promoção de ingresso',
    'Está tudo certo com a sua reserva',
    'Quais são as datas da sua viagem?',
    '',
  ])('deixa passar "%s"', (text) => {
    expect(containsWrongVisaClaim(text)).toBe(false);
  });
});
