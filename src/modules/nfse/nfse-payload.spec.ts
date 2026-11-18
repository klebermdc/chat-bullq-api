import { parseNfsePayload } from './nfse-payload';

const VALID = {
  envioId: '3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f',
  telefone: '5511988887777',
  nome: 'Maria Souza',
  numeroNfse: '12',
  valor: 1800.48,
  pdfUrl: 'https://hub.example.com/nfse/12.pdf?token=abc',
  pdfNome: 'NFS-e 12 - Orlando Fast Pass.pdf',
};

describe('parseNfsePayload', () => {
  it('accepts a valid body and keeps the values', () => {
    const result = parseNfsePayload(VALID);

    expect(result).toEqual({ ok: true, value: { ...VALID } });
  });

  it('adds the 55 country code when the phone comes without it', () => {
    const result = parseNfsePayload({ ...VALID, telefone: '11988887777' });

    expect(result.ok && result.value.telefone).toBe('5511988887777');
  });

  it('accepts a 12-digit landline with 55', () => {
    const result = parseNfsePayload({ ...VALID, telefone: '551133334444' });

    expect(result.ok).toBe(true);
  });

  it('rejects a phone with non-digit characters', () => {
    const result = parseNfsePayload({ ...VALID, telefone: '+55 11 98888-7777' });

    expect(result).toEqual({ ok: false, error: 'telefone: use só dígitos, com DDI 55.' });
  });

  it('rejects a phone that does not end with 12 or 13 digits', () => {
    const result = parseNfsePayload({ ...VALID, telefone: '55119888877' });

    expect(result.ok).toBe(false);
  });

  it('rejects a foreign phone', () => {
    const result = parseNfsePayload({ ...VALID, telefone: '14075551234' });

    expect(result.ok).toBe(false);
  });

  it('rejects a body that is not an object', () => {
    expect(parseNfsePayload(null).ok).toBe(false);
    expect(parseNfsePayload('x').ok).toBe(false);
  });

  it.each(['envioId', 'telefone', 'nome', 'numeroNfse', 'valor', 'pdfUrl', 'pdfNome'])(
    'rejects a body without %s',
    (field) => {
      const body: Record<string, unknown> = { ...VALID };
      delete body[field];

      const result = parseNfsePayload(body);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain(field);
    },
  );

  it('rejects an envioId that is not a uuid', () => {
    expect(parseNfsePayload({ ...VALID, envioId: 'nota-12' }).ok).toBe(false);
  });

  it('accepts numeroNfse sent as a number', () => {
    const result = parseNfsePayload({ ...VALID, numeroNfse: 12 });

    expect(result.ok && result.value.numeroNfse).toBe('12');
  });

  it.each([0, -1, Number.NaN, '1800,48', Infinity])('rejects valor %p', (valor) => {
    expect(parseNfsePayload({ ...VALID, valor }).ok).toBe(false);
  });

  it.each(['http://hub.example.com/a.pdf', 'ftp://x/a.pdf', 'not a url', 'https://user:pw@x.com/a.pdf'])(
    'rejects pdfUrl %p',
    (pdfUrl) => {
      expect(parseNfsePayload({ ...VALID, pdfUrl }).ok).toBe(false);
    },
  );

  it('cleans the pdf name and keeps the .pdf extension', () => {
    const result = parseNfsePayload({ ...VALID, pdfNome: '../notas/NFS-e 12' });

    expect(result.ok && result.value.pdfNome).toBe('notas_NFS-e 12.pdf');
  });

  it('trims the name', () => {
    const result = parseNfsePayload({ ...VALID, nome: '  Maria Souza ' });

    expect(result.ok && result.value.nome).toBe('Maria Souza');
  });
});
