import { buildProposalMessage } from './message-builder';
import { ExtractedCart } from './proposals.types';

const base: ExtractedCart = {
  adults: 3,
  children: 0,
  startDate: '2026-10-02',
  endDate: '2026-10-06',
  parks: [
    { nome: 'UNIVERSAL ORLANDO RESORT: PROMOCIONAL 3 DIAS PARK TO PARK', dias: 5, data: '2026-10-02' },
  ],
  totalValue: 4200.5,
  currency: 'BRL',
};

describe('buildProposalMessage', () => {
  const url = 'https://reservas.orlandofastpass.com.br/pt/checkout/abc';

  it('inclui link, adultos e datas em DD/MM/AAAA', () => {
    const msg = buildProposalMessage(base, url);
    expect(msg).toContain(`👉 ${url}`);
    // linha em branco entre a frase de abertura e o link
    expect(msg).toContain(`detalhes:\n\n👉 ${url}`);
    expect(msg).toContain('Para 3 Adultos entre os dias 02/10/2026 e 06/10/2026');
    expect(msg).toContain('UNIVERSAL ORLANDO RESORT: PROMOCIONAL 3 DIAS PARK TO PARK [5 dias] - 02/10/2026');
  });

  it('inclui crianças quando children > 0', () => {
    const msg = buildProposalMessage({ ...base, adults: 2, children: 2 }, url);
    expect(msg).toContain('Para 2 Adultos e 2 Crianças entre os dias');
  });

  it('usa singular para 1 adulto e 1 criança', () => {
    const msg = buildProposalMessage({ ...base, adults: 1, children: 1 }, url);
    expect(msg).toContain('Para 1 Adulto e 1 Criança entre os dias');
  });

  it('lista todos os parques, um por linha', () => {
    const msg = buildProposalMessage(
      {
        ...base,
        parks: [
          { nome: 'UNIVERSAL', dias: 5, data: '2026-10-02' },
          { nome: 'WALT DISNEY WORLD', dias: 4, data: '2026-10-03' },
        ],
      },
      url,
    );
    expect(msg).toContain('UNIVERSAL [5 dias] - 02/10/2026');
    expect(msg).toContain('WALT DISNEY WORLD [4 dias] - 03/10/2026');
  });

  it('nunca inclui o valor na mensagem', () => {
    const msg = buildProposalMessage(base, url);
    expect(msg).not.toContain('4200');
    expect(msg).not.toContain('4.200');
    expect(msg).not.toMatch(/R\$/);
  });
});
