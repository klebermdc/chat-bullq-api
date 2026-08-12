import { isPubliclyServable } from './public-key.util';

/**
 * `/api/v1/uploads/<chave>` é servido sem autenticação — tem que ser, porque
 * quem busca a mídia é o servidor da Meta (o adapter oficial manda
 * `link: mediaUrl` e a Meta faz o GET) e a tag `<img>`/`<audio>` do navegador,
 * que não manda header `Authorization`.
 *
 * O problema é que a rota servia QUALQUER chave do bucket, que é único para
 * todas as organizações — inclusive `acceptances/<data>/<id>.pdf`, o PDF do
 * aceite assinado, com nome do cliente, IP e assinatura.
 *
 * A decisão aqui é allowlist, não denylist: prefixo novo nasce fechado.
 */
describe('isPubliclyServable', () => {
  it.each([
    'media/2026-08-06/foto.jpg',
    'audio/2026-07-05/x.ogg',
    'inbound/canal1/2026-08-01/doc.pdf',
    'playback/abc123.m4a',
  ])('serve o prefixo público %s', (chave) => {
    expect(isPubliclyServable(chave)).toBe(true);
  });

  it('não serve o PDF do aceite assinado', () => {
    expect(isPubliclyServable('acceptances/2026-08-06/acc123.pdf')).toBe(false);
  });

  it('nega prefixo desconhecido — allowlist, não denylist', () => {
    // O ponto da allowlist: um prefixo privado novo (ex.: relatórios internos)
    // nasce fechado, em vez de vazar até alguém lembrar de bloqueá-lo.
    expect(isPubliclyServable('relatorios/2026/faturamento.pdf')).toBe(false);
    expect(isPubliclyServable('backup.sql')).toBe(false);
  });

  it('nega travessia de diretório mesmo sob prefixo válido', () => {
    expect(isPubliclyServable('media/../acceptances/2026-08-06/x.pdf')).toBe(
      false,
    );
    expect(isPubliclyServable('media/..%2facceptances/x.pdf')).toBe(false);
  });

  it('nega chave vazia', () => {
    expect(isPubliclyServable('')).toBe(false);
    expect(isPubliclyServable('   ')).toBe(false);
  });

  it('não deixa prefixo passar por semelhança de nome', () => {
    // "mediaX/" não é "media/" — casar por `startsWith('media')` sem a barra
    // abriria um prefixo irmão sem querer.
    expect(isPubliclyServable('mediaX/segredo.pdf')).toBe(false);
    expect(isPubliclyServable('acceptances-publico/x.pdf')).toBe(false);
  });
});
