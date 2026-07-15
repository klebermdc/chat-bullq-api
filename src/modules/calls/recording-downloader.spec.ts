import { RecordingDownloader } from './recording-downloader';

function mockRes(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  bytes?: number;
}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? opts.contentType ?? 'audio/mpeg' : null) },
    arrayBuffer: async () => new ArrayBuffer(opts.bytes ?? 4096),
  } as any;
}

describe('RecordingDownloader.download', () => {
  it('devolve buffer + mime quando a gravação está pronta', async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRes({ contentType: 'audio/mpeg', bytes: 5000 }));
    const dl = new RecordingDownloader(fetchMock);
    const out = await dl.download('https://gravacoes.sonax.cloud/x');
    expect(out.buffer.byteLength).toBe(5000);
    expect(out.mimeType).toBe('audio/mpeg');
  });

  it('lança quando ainda vem HTML (gravação não pronta) — pra re-tentar', async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRes({ contentType: 'text/html', bytes: 3000 }));
    const dl = new RecordingDownloader(fetchMock);
    await expect(dl.download('https://x')).rejects.toThrow();
  });

  it('lança quando o corpo é vazio/pequeno (< 1KB) — pra re-tentar', async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRes({ contentType: 'audio/mpeg', bytes: 10 }));
    const dl = new RecordingDownloader(fetchMock);
    await expect(dl.download('https://x')).rejects.toThrow();
  });

  it('lança em HTTP não-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockRes({ ok: false, status: 404 }));
    const dl = new RecordingDownloader(fetchMock);
    await expect(dl.download('https://x')).rejects.toThrow();
  });
});
