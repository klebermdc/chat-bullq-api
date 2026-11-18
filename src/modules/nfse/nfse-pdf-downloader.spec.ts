import { downloadNfsePdf, isPrivateAddress, MAX_PDF_BYTES, NfsePdfError } from './nfse-pdf-downloader';

function response(body: Buffer | string, init: { status?: number; length?: number } = {}) {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  const headers = new Headers();
  if (init.length !== undefined) headers.set('content-length', String(init.length));
  return new Response(new Uint8Array(bytes), { status: init.status ?? 200, headers });
}

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.18.0.3', '192.168.1.1', '169.254.169.254', '::1', '::ffff:10.0.0.1'])(
    'blocks %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(['8.8.8.8', '187.77.213.165', '2606:4700::1111'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('downloadNfsePdf', () => {
  it('returns the pdf bytes', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response('%PDF-1.7 conteudo'));

    const pdf = await downloadNfsePdf('https://8.8.8.8/nota.pdf', fetchImpl);

    expect(pdf.toString()).toBe('%PDF-1.7 conteudo');
  });

  it('refuses a link to the internal network without fetching', async () => {
    const fetchImpl = jest.fn();

    await expect(downloadNfsePdf('https://127.0.0.1/x.pdf', fetchImpl)).rejects.toBeInstanceOf(NfsePdfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a pdf', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response('<html>login</html>'));

    await expect(downloadNfsePdf('https://8.8.8.8/x.pdf', fetchImpl)).rejects.toThrow('não é um PDF');
  });

  it('refuses an expired link (HTTP error)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response('', { status: 403 }));

    await expect(downloadNfsePdf('https://8.8.8.8/x.pdf', fetchImpl)).rejects.toThrow('HTTP 403');
  });

  it('refuses a file larger than the limit', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response('%PDF-', { length: MAX_PDF_BYTES + 1 }));

    await expect(downloadNfsePdf('https://8.8.8.8/x.pdf', fetchImpl)).rejects.toThrow('10 MB');
  });
});
