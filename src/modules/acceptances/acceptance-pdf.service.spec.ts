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

  it('lista os vouchers entregues com nome e hash no HTML do comprovante', () => {
    const svc = new AcceptancePdfService({} as any);

    const html = (svc as any).html({
      organizationName: 'OFP',
      termText: 'Confirmo o recebimento.',
      items: [{ description: 'Magic Kingdom' }],
      signerName: 'Gabriela',
      signedAt: new Date('2026-08-06T12:00:00Z'),
      vouchers: [{ url: 'https://x/a.pdf', filename: 'voucher.pdf', size: 10, sha256: 'abc123' }],
      orderRef: '61293',
    });

    expect(html).toContain('voucher.pdf');
    expect(html).toContain('abc123');
    expect(html).toContain('61293');
  });

  it('não quebra quando não há voucher', () => {
    const svc = new AcceptancePdfService({} as any);

    const html = (svc as any).html({
      organizationName: 'OFP',
      termText: 'Confirmo.',
      items: [{ description: 'X' }],
      signerName: 'Ana',
      signedAt: new Date('2026-08-06T12:00:00Z'),
    });

    expect(html).toContain('Ana');
    expect(html).not.toContain('Vouchers entregues');
  });

  it('escapa o nome do voucher e ainda lista o arquivo quando o hash está vazio', () => {
    const svc = new AcceptancePdfService({} as any);

    const html = (svc as any).html({
      organizationName: 'OFP',
      termText: 'Confirmo.',
      items: [{ description: 'X' }],
      signerName: 'Ana',
      signedAt: new Date('2026-08-06T12:00:00Z'),
      vouchers: [{ url: 'https://x/a.pdf', filename: '<img src=x onerror=alert(1)>.pdf', size: 10, sha256: '' }],
      orderRef: '<b>61293</b>',
    });

    expect(html).toContain('Vouchers entregues');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).not.toContain('<b>61293</b>');
    expect(html).not.toContain('SHA-256');
  });

  describe('política de cancelamento', () => {
    function html(over: Record<string, unknown> = {}) {
      const svc = new AcceptancePdfService({} as any);
      return (svc as any).html({
        organizationName: 'OFP',
        termText: 'Declaro que recebi.',
        items: [{ description: 'Magic Kingdom' }],
        signerName: 'Ana',
        signedAt: new Date('2026-08-06T12:00:00Z'),
        ...over,
      }) as string;
    }

    it('renderiza a seção com o texto, depois do termo e dos itens', () => {
      const out = html({ policyText: 'Cancelamento em até 7 dias com reembolso integral.' });

      expect(out).toContain('Política de cancelamento');
      expect(out).toContain('Cancelamento em até 7 dias com reembolso integral.');
      expect(out.indexOf('Política de cancelamento')).toBeGreaterThan(out.indexOf('Itens conferidos'));
      expect(out.indexOf('Política de cancelamento')).toBeGreaterThan(out.indexOf('Declaro que recebi.'));
    });

    it('preserva as quebras de linha da política (senão vira um parágrafo ilegível)', () => {
      const out = html({ policyText: 'Regra 1: até 7 dias.\nRegra 2: taxa de 10%.' });

      expect(out).toContain('white-space:pre-wrap');
      expect(out).toContain('Regra 1: até 7 dias.\nRegra 2: taxa de 10%.');
    });

    it('sem política não renderiza heading vazio', () => {
      expect(html()).not.toContain('Política de cancelamento');
      expect(html({ policyText: null })).not.toContain('Política de cancelamento');
      expect(html({ policyText: '   ' })).not.toContain('Política de cancelamento');
    });

    // O comprovante só vale em disputa se provar o ACEITE. "O texto estava na
    // página" é atacável; "declarou ter lido e aceito" não é.
    it('declara o aceite da política dentro do bloco da assinatura', () => {
      const out = html({ policyText: 'Cancelamento em até 7 dias.', signerIp: '1.2.3.4' });

      expect(out).toContain('Declarou ter lido e aceito a política de cancelamento acima.');
      // Amarrada ao ato de assinar: tem que estar DEPOIS do início do bloco
      // .meta e antes do fim dele, não flutuando no corpo do documento.
      expect(out.indexOf('Declarou ter lido e aceito')).toBeGreaterThan(out.indexOf('class="meta"'));
      expect(out.indexOf('Declarou ter lido e aceito')).toBeLessThan(out.indexOf('MP 2.200-2/2001'));
    });

    it('sem política não existe declaração de aceite', () => {
      expect(html()).not.toContain('Declarou ter lido e aceito');
      expect(html({ policyText: null })).not.toContain('Declarou ter lido e aceito');
      expect(html({ policyText: '   ' })).not.toContain('Declarou ter lido e aceito');
    });

    it('escapa HTML da política (o texto vem do dono da org e o PDF é um documento legal)', () => {
      const out = html({ policyText: '<script>alert(1)</script> cancelamento <b>grátis</b>' });

      expect(out).not.toContain('<script>alert(1)</script>');
      expect(out).not.toContain('<b>grátis</b>');
      expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });
});
