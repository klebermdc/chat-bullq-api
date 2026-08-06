import { storageKeyFromUploadUrl } from './storage-key.util';

const OK_URL = 'https://api.exemplo.com/api/v1/uploads/media/2026-08-06/abc123.pdf';

describe('storageKeyFromUploadUrl', () => {
  it('extrai a chave de uma URL de upload', () => {
    expect(storageKeyFromUploadUrl(OK_URL)).toBe('media/2026-08-06/abc123.pdf');
  });

  it('aceita a chave crua (sem host)', () => {
    expect(storageKeyFromUploadUrl('media/2026-08-06/abc123.pdf')).toBe(
      'media/2026-08-06/abc123.pdf',
    );
  });

  it('aceita a forma relativa, sem host', () => {
    expect(
      storageKeyFromUploadUrl('/api/v1/uploads/media/2026-08-06/abc123.pdf'),
    ).toBe('media/2026-08-06/abc123.pdf');
  });

  it('devolve null para URL de outro domínio/rota — nunca lê fora do storage', () => {
    expect(storageKeyFromUploadUrl('https://evil.com/etc/passwd')).toBeNull();
  });

  it('devolve null para travessia de diretório', () => {
    expect(
      storageKeyFromUploadUrl('https://api.exemplo.com/api/v1/uploads/../../secret'),
    ).toBeNull();
  });

  it('devolve null para travessia percent-encoded', () => {
    expect(
      storageKeyFromUploadUrl(
        'https://api.exemplo.com/api/v1/uploads/media/%2e%2e%2f%2e%2e%2fsecret',
      ),
    ).toBeNull();
    expect(storageKeyFromUploadUrl('media/%2e%2e/acceptances/x.pdf')).toBeNull();
  });

  it('devolve null quando o percent-encoding é malformado', () => {
    expect(storageKeyFromUploadUrl('media/2026-08-06/%E0%A4%A.pdf')).toBeNull();
  });

  // O buraco que motivou o escopo por prefixo: o bucket é compartilhado entre
  // orgs e o PDF assinado de um aceite mora em `acceptances/<data>/<id>.pdf`.
  // Sem esta trava, qualquer usuário autenticado que descubra um id de aceite
  // lê o aceite assinado de outro tenant como "itens extraídos".
  it('devolve null para chave fora do prefixo media/ (aceite de outro tenant)', () => {
    expect(
      storageKeyFromUploadUrl('acceptances/2026-08-06/acc-de-outra-org.pdf'),
    ).toBeNull();
    expect(
      storageKeyFromUploadUrl(
        'https://api.exemplo.com/api/v1/uploads/acceptances/2026-08-06/acc-de-outra-org.pdf',
      ),
    ).toBeNull();
    expect(storageKeyFromUploadUrl('audio/2026-08-06/x.mp3')).toBeNull();
    expect(storageKeyFromUploadUrl('inbound/wa/2026-08-06/x.pdf')).toBeNull();
  });

  // A chave sai SÓ do pathname. Sem isso, `indexOf` do marcador casa dentro de
  // query/fragmento e uma URL de terceiro contrabandeia a chave que quiser.
  it('devolve null quando o marcador vem só na query ou no fragmento', () => {
    expect(
      storageKeyFromUploadUrl(
        'https://evil.com/redir?next=/api/v1/uploads/media/2026-08-06/y.pdf',
      ),
    ).toBeNull();
    expect(
      storageKeyFromUploadUrl(
        'https://evil.com/x#/api/v1/uploads/media/2026-08-06/y.pdf',
      ),
    ).toBeNull();
  });

  it('query string numa URL legítima não entra na chave', () => {
    expect(storageKeyFromUploadUrl(`${OK_URL}?download=1#page=2`)).toBe(
      'media/2026-08-06/abc123.pdf',
    );
  });

  it('devolve null para URL malformada', () => {
    expect(storageKeyFromUploadUrl('https://')).toBeNull();
    expect(storageKeyFromUploadUrl('')).toBeNull();
  });

  // O host NÃO é examinado, de propósito — veja o docblock do util. A chave é o
  // que importa: quem consegue escrever um host estranho consegue escrever o
  // nosso. O que fecha o buraco é o prefixo `media/`, e ele vale venha de onde
  // vier — inclusive de um host forjado.
  it('host estranho não amplia nada: o prefixo media/ vale para qualquer host', () => {
    expect(
      storageKeyFromUploadUrl(
        'https://evil.com/api/v1/uploads/media/2026-08-06/abc123.pdf',
      ),
    ).toBe('media/2026-08-06/abc123.pdf');
    expect(
      storageKeyFromUploadUrl(
        'https://evil.com/api/v1/uploads/acceptances/2026-08-06/acc-1.pdf',
      ),
    ).toBeNull();
  });
});
