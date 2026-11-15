import { NotFoundException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { safeFilename, streamAttachment } from './attachment-stream';
import { parsePage } from './pagination';

describe('streamAttachment', () => {
  it('envia como download (nunca inline) com nosniff', async () => {
    const body = new PassThrough();
    const storage = {
      stat: jest.fn().mockResolvedValue({ size: 3, contentType: 'text/html' }),
      getStream: jest.fn().mockResolvedValue(body),
    };
    const headers: Record<string, string> = {};
    const res = Object.assign(new PassThrough(), {
      setHeader: (k: string, v: string) => { headers[k] = v; },
    });

    await streamAttachment(storage as never, res as never, { key: 'email/o/e/0', filename: 'página".html', contentType: 'text/html' });

    expect(headers['Content-Disposition']).toMatch(/^attachment; filename="p_gina_.html"; filename\*=UTF-8''/);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Length']).toBe('3');
  });

  it('objeto sumido do MinIO: 404 antes de qualquer header', async () => {
    const storage = { stat: jest.fn().mockResolvedValue(null), getStream: jest.fn() };
    await expect(
      streamAttachment(storage as never, {} as never, { key: 'k', filename: 'f', contentType: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getStream).not.toHaveBeenCalled();
  });
});

describe('safeFilename', () => {
  it('troca caracteres perigosos e nunca fica vazio', () => {
    expect(safeFilename('a\r\nb.pdf')).toBe('a__b.pdf');
    expect(safeFilename('')).toBe('anexo');
  });
});

describe('parsePage', () => {
  it('usa padrões sãos e limita o tamanho da página', () => {
    expect(parsePage()).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePage('3', '500')).toEqual({ page: 3, limit: 100, skip: 200 });
    expect(parsePage('-1', 'abc')).toEqual({ page: 1, limit: 20, skip: 0 });
  });
});
