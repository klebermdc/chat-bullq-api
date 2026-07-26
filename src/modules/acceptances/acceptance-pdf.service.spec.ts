import { AcceptancePdfService } from './acceptance-pdf.service';

function fakeBrowserType(pdfBuf = Buffer.from('%PDF-1.4 fake')) {
  const page = {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(pdfBuf),
  };
  const browser = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
  return { launch: jest.fn().mockResolvedValue(browser), _page: page, _browser: browser } as any;
}

describe('AcceptancePdfService', () => {
  it('renderiza HTML do termo e devolve o buffer do PDF, fechando o browser', async () => {
    const bt = fakeBrowserType();
    const svc = new AcceptancePdfService(bt);
    const buf = await svc.render({
      organizationName: 'Orlando Fast Pass',
      termText: 'Declaro que recebi...',
      items: [{ description: 'Ingresso Disney', qty: 2 }],
      signerName: 'João Silva',
      signedAt: new Date('2026-07-26T14:00:00Z'),
      signerIp: '1.2.3.4',
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(bt._page.setContent).toHaveBeenCalledWith(expect.stringContaining('Ingresso Disney'), expect.any(Object));
    expect(bt._page.setContent).toHaveBeenCalledWith(expect.stringContaining('João Silva'), expect.any(Object));
    expect(bt._browser.close).toHaveBeenCalled();
  });

  it('escapa HTML nos campos do usuário (evita injeção de markup no PDF)', async () => {
    const bt = fakeBrowserType();
    const svc = new AcceptancePdfService(bt);
    await svc.render({
      organizationName: 'X', termText: 'T',
      items: [{ description: '<script>alert(1)</script>' }],
      signerName: 'a<b>c', signedAt: new Date('2026-07-26T14:00:00Z'), signerIp: null,
    });
    const html = bt._page.setContent.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
