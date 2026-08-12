import { isPubliclyServableKey } from './public-storage-keys';

describe('isPubliclyServableKey', () => {
  it('libera a mídia que provedor externo precisa baixar pra entregar ao cliente', () => {
    expect(isPubliclyServableKey('audio/2026-08-11/x.ogg')).toBe(true);
    expect(isPubliclyServableKey('media/2026-08-11/foto.jpg')).toBe(true);
    expect(isPubliclyServableKey('uploads/2026-08-11/doc.pdf')).toBe(true);
  });

  it('recusa o PDF assinado do aceite — tem assinatura, IP e dado pessoal', () => {
    expect(isPubliclyServableKey('acceptances/2026-08-11/abc123.pdf')).toBe(false);
  });

  it('fecha por padrão: prefixo desconhecido não vaza', () => {
    // Esta é a regra que importa. Quem criar um tipo de arquivo novo amanhã
    // não expõe nada sem passar por aqui de propósito.
    expect(isPubliclyServableKey('transcripts/2026-08-11/conversa.pdf')).toBe(false);
    expect(isPubliclyServableKey('backups/dump.sql')).toBe(false);
    expect(isPubliclyServableKey('qualquer-coisa.txt')).toBe(false);
  });

  it('não deixa prefixo público ser imitado', () => {
    expect(isPubliclyServableKey('audiozinho/x.ogg')).toBe(false);
    expect(isPubliclyServableKey('media-privada/x.jpg')).toBe(false);
    expect(isPubliclyServableKey('nao/media/x.jpg')).toBe(false);
  });

  it('recusa travessia de caminho mesmo sob prefixo público', () => {
    expect(isPubliclyServableKey('media/../acceptances/x.pdf')).toBe(false);
    expect(isPubliclyServableKey('audio/./../acceptances/x.pdf')).toBe(false);
  });

  it('recusa chave vazia', () => {
    expect(isPubliclyServableKey('')).toBe(false);
    expect(isPubliclyServableKey('/')).toBe(false);
  });
});
