import { buildContractHtml } from './contract-pdf.service';

const base = {
  company: { name: 'Orlando Fast Pass', document: '33.142.150/0001-99', address: 'Rua X, 1' },
  contract: {
    fullName: 'Cliente <b>Teste</b>', cpf: '000.000.000-00', address: 'Rua A', cep: '00000-000', email: 'c@x.com',
    phone: '1', guideName: 'Kleber', people: 2, days: 1, amount: '2190,00', paymentMethod: null, notes: null,
    dates: [{ label: 'EPCOT', date: '2026-12-02' }],
  },
  terms: 'Termo 1',
};

describe('buildContractHtml', () => {
  it('escapa dados do cliente', () => {
    const html = buildContractHtml(base);
    expect(html).toContain('Cliente &lt;b&gt;Teste&lt;/b&gt;');
    expect(html).not.toContain('<b>Teste</b>');
  });

  it('prefixa R$ em valor BRL e mantém $ em USD', () => {
    expect(buildContractHtml(base)).toContain('R$ 2190,00');
    expect(buildContractHtml({ ...base, contract: { ...base.contract, amount: '$ 150.00' } })).toContain('$ 150.00');
  });

  it('sem aceite não tem bloco de evidência', () => {
    expect(buildContractHtml(base)).not.toContain('Aceite eletrônico');
  });

  it('com aceite mostra assinatura, data em São Paulo, IP e termos aceitos', () => {
    const html = buildContractHtml({
      ...base,
      acceptance: {
        acceptedAt: new Date('2026-10-15T19:30:00Z'), ip: '1.2.3.4', userAgent: 'UA',
        signaturePngBase64: 'AAAA', acceptedTerms: 'Termo aceito',
      },
    });
    expect(html).toContain('Aceite eletrônico');
    expect(html).toContain('15/10/2026 16:30');
    expect(html).toContain('1.2.3.4');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('Termo aceito');
  });
});
