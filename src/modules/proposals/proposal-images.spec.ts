import { sniffImageMime } from './proposal-images';

describe('sniffImageMime', () => {
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8 '),
  ]);

  it('reconhece PNG, JPEG e WebP pela assinatura', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(sniffImageMime(webp)).toBe('image/webp');
  });

  it.each([
    ['PDF', Buffer.from('%PDF-1.7')],
    ['GIF', Buffer.from('GIF89a')],
    ['RIFF que não é WebP (WAV)', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])],
    ['assinatura PNG cortada', Buffer.from([0x89, 0x50, 0x4e])],
    ['vazio', Buffer.alloc(0)],
  ])('devolve null para %s', (_name, buffer) => {
    expect(sniffImageMime(buffer)).toBeNull();
  });
});
