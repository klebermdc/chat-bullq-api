import { storageKeyFromUploadUrl } from './storage-key.util';

describe('storageKeyFromUploadUrl', () => {
  it('extrai a chave de uma URL de upload', () => {
    expect(
      storageKeyFromUploadUrl(
        'https://api.exemplo.com/api/v1/uploads/media/2026-08-06/abc123.pdf',
      ),
    ).toBe('media/2026-08-06/abc123.pdf');
  });

  it('aceita a chave crua (sem host)', () => {
    expect(storageKeyFromUploadUrl('media/2026-08-06/abc123.pdf')).toBe(
      'media/2026-08-06/abc123.pdf',
    );
  });

  it('devolve null para URL de outro domínio/rota — nunca lê fora do storage', () => {
    expect(storageKeyFromUploadUrl('https://evil.com/etc/passwd')).toBeNull();
  });

  it('devolve null para travessia de diretório', () => {
    expect(
      storageKeyFromUploadUrl('https://api.exemplo.com/api/v1/uploads/../../secret'),
    ).toBeNull();
  });
});
