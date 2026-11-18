import { buildNfseTemplateContent, formatBrl, nfseMessageText } from './nfse-message';

describe('formatBrl', () => {
  it('formats in reais with a regular space', () => {
    expect(formatBrl(1800.48)).toBe('R$ 1.800,48');
    expect(formatBrl(90)).toBe('R$ 90,00');
  });
});

describe('nfseMessageText', () => {
  it('uses the first name, the invoice number and the value', () => {
    const text = nfseMessageText({ nome: 'Maria Souza', numeroNfse: '12', valor: 1800.48 });

    expect(text).toBe(
      'Olá, Maria! Segue a nota fiscal do seu guiamento com a Orlando Fast Pass ' +
        '(NFS-e nº 12, R$ 1.800,48). Qualquer dúvida, é só responder aqui.',
    );
  });
});

describe('buildNfseTemplateContent', () => {
  it('sends the pdf in the header and name, number and value in the body', () => {
    const content = buildNfseTemplateContent({
      templateName: 'nfse_guiamento',
      language: 'pt_BR',
      nome: 'Maria Souza',
      numeroNfse: '12',
      valor: 1800.48,
      pdfLink: 'https://api.example.com/api/v1/uploads/media/x.pdf',
      pdfNome: 'NFS-e 12.pdf',
    });

    expect(content).toEqual({
      name: 'nfse_guiamento',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: {
                link: 'https://api.example.com/api/v1/uploads/media/x.pdf',
                filename: 'NFS-e 12.pdf',
              },
            },
          ],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: '12' },
            { type: 'text', text: 'R$ 1.800,48' },
          ],
        },
      ],
    });
  });
});
