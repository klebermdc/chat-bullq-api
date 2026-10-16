import type { BrowserType } from 'playwright';
import { buildContractHtml, ContractPdfService, paymentLabel, type ContractPdfInput } from './contract-pdf.service';

/** PNG 1x1 válido. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const base: ContractPdfInput = {
  company: { name: 'Orlando Fast Pass', document: '33.142.150/0001-99', address: 'Rua X, 1' },
  contract: {
    fullName: 'Cliente <b>Teste</b>', cpf: '000.000.000-00', address: 'Rua A', cep: '00000-000', email: 'c@x.com',
    phone: '1', guideName: 'Kleber', people: 2, days: 1, amount: '2190,00', paymentMethod: null, notes: null,
    dates: [{ label: 'EPCOT', date: '2026-12-02' }],
  },
  terms: 'Termo 1',
};

const withSignature = (signaturePngBase64: string | null): ContractPdfInput => ({
  ...base,
  acceptance: {
    acceptedAt: new Date('2026-10-15T19:30:00Z'), ip: '1.2.3.4', userAgent: 'UA',
    signaturePngBase64, acceptedTerms: 'Termo aceito',
  },
});

describe('buildContractHtml', () => {
  it('escapa dados do cliente', () => {
    const html = buildContractHtml(base);
    expect(html).toContain('Cliente &lt;b&gt;Teste&lt;/b&gt;');
    expect(html).not.toContain('<b>Teste</b>');
  });

  it('prefixa R$ em valor BRL e mantém $ em USD', () => {
    expect(buildContractHtml(base)).toContain('R$ 2190,00');
    expect(buildContractHtml({ ...base, contract: { ...base.contract, amount: '$ 150.00' } })).toContain('$ 150.00');
  });

  it('sem aceite não tem bloco de evidência', () => {
    expect(buildContractHtml(base)).not.toContain('Aceite eletrônico');
  });

  it('com aceite mostra assinatura, data em São Paulo, IP e termos aceitos', () => {
    const html = buildContractHtml(withSignature(PNG_1X1));
    expect(html).toContain('Aceite eletrônico');
    expect(html).toContain('15/10/2026 16:30');
    expect(html).toContain('1.2.3.4');
    expect(html).toContain(`data:image/png;base64,${PNG_1X1}`);
    expect(html).toContain('Termo aceito');
  });

  it('aceite sem assinatura não renderiza imagem', () => {
    expect(buildContractHtml(withSignature(null))).not.toContain('<img');
  });

  it('CSP é o primeiro filho do <head>', () => {
    expect(buildContractHtml(base)).toContain(
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    );
  });

  describe('assinatura inválida lança e não renderiza', () => {
    it.each([
      ['aspas', `${PNG_1X1}" onerror="alert(1)`],
      ['onerror', 'AAAA onerror=alert(1)'],
      ['script', '<script>alert(1)</script>'],
      ['base64 que não é PNG', Buffer.from('GIF89a-nao-e-png').toString('base64')],
      ['vazia', ''],
      ['grande demais', 'A'.repeat(700_004)],
    ])('%s', (_name, sig) => {
      expect(() => buildContractHtml(withSignature(sig))).toThrow('Assinatura inválida');
    });
  });
});

describe('paymentLabel', () => {
  it.each([
    [null, 'À vista'],
    ['pix', 'PIX à vista'],
    ['dolar', 'Dólar (Wise/ACH)'],
    ['cartao-3x', 'Cartão em 3x'],
    ['cartao-12x', 'Cartão em 12x'],
    ['Boleto', 'Boleto'],
  ])('%s → %s', (input, expected) => {
    expect(paymentLabel(input)).toBe(expected);
  });

  it('texto livre aparece escapado no HTML', () => {
    const html = buildContractHtml({ ...base, contract: { ...base.contract, paymentMethod: '<i>x</i>' } });
    expect(html).toContain('<td>&lt;i&gt;x&lt;/i&gt;</td>');
    expect(html).not.toContain('<i>x</i>');
  });

  it('PDF mostra o rótulo legível', () => {
    const html = buildContractHtml({ ...base, contract: { ...base.contract, paymentMethod: 'cartao-10x' } });
    expect(html).toContain('<td>Cartão em 10x</td>');
  });
});

function fakeBrowser(opts: { pdf?: () => Promise<Buffer>; onPdfStart?: () => void } = {}) {
  const routeHandlers: Array<(r: unknown) => unknown> = [];
  const page = {
    route: jest.fn(async (_pattern: string, handler: (r: unknown) => unknown) => {
      routeHandlers.push(handler);
    }),
    setContent: jest.fn(async () => undefined),
    pdf: jest.fn(async () => {
      opts.onPdfStart?.();
      return opts.pdf ? opts.pdf() : Buffer.from('%PDF');
    }),
  };
  const context = { newPage: jest.fn(async () => page), close: jest.fn(async () => undefined) };
  const browser = { newContext: jest.fn(async () => context), close: jest.fn(async () => undefined) };
  const browserType = { launch: jest.fn(async () => browser) } as unknown as BrowserType;
  return { browserType, browser, context, page, routeHandlers };
}

describe('ContractPdfService.render', () => {
  it('usa contexto sem JavaScript, bloqueia rede fora de data: e fecha tudo', async () => {
    const f = fakeBrowser();
    const out = await new ContractPdfService(f.browserType).render(base);

    expect(out.toString()).toBe('%PDF');
    expect(f.browser.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false });
    expect(f.page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(f.page.setContent).toHaveBeenCalledWith(expect.stringContaining('<!doctype html>'), {
      waitUntil: 'load',
      timeout: 15_000,
    });
    expect(f.context.close).toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalled();

    const handler = f.routeHandlers[0];
    const mkRoute = (url: string) => ({
      request: () => ({ url: () => url }),
      continue: jest.fn(),
      abort: jest.fn(),
    });
    const dataRoute = mkRoute('data:image/png;base64,AAAA');
    const httpRoute = mkRoute('https://evil.example/x.png');
    handler(dataRoute);
    handler(httpRoute);
    expect(dataRoute.continue).toHaveBeenCalled();
    expect(dataRoute.abort).not.toHaveBeenCalled();
    expect(httpRoute.abort).toHaveBeenCalled();
    expect(httpRoute.continue).not.toHaveBeenCalled();
  });

  it('assinatura inválida falha antes de abrir o navegador', async () => {
    const f = fakeBrowser();
    await expect(new ContractPdfService(f.browserType).render(withSignature('<script>'))).rejects.toThrow(
      'Assinatura inválida',
    );
    expect(f.browserType.launch).not.toHaveBeenCalled();
  });

  it('page.pdf travado estoura em 20s e ainda fecha contexto e navegador', async () => {
    jest.useFakeTimers();
    try {
      const f = fakeBrowser({ pdf: () => new Promise<Buffer>(() => undefined) });
      const p = new ContractPdfService(f.browserType).render(base);
      const assertion = expect(p).rejects.toThrow(/tempo/i);
      await jest.advanceTimersByTimeAsync(20_000);
      await assertion;
      expect(f.context.close).toHaveBeenCalled();
      expect(f.browser.close).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('no máximo 2 renders simultâneos por processo', async () => {
    let active = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const f = fakeBrowser({
      onPdfStart: () => {
        active += 1;
        peak = Math.max(peak, active);
      },
      pdf: () =>
        new Promise<Buffer>((resolve) =>
          gates.push(() => {
            active -= 1;
            resolve(Buffer.from('%PDF'));
          }),
        ),
    });
    const svc = new ContractPdfService(f.browserType);
    const renders = [svc.render(base), svc.render(base), svc.render(base)];
    const flush = () => new Promise((r) => setImmediate(r));
    await flush();
    await flush();
    expect(f.browserType.launch).toHaveBeenCalledTimes(2);

    gates[0]();
    await flush();
    await flush();
    expect(f.browserType.launch).toHaveBeenCalledTimes(3);
    gates[1]();
    gates[2]();
    await Promise.all(renders);
    expect(peak).toBe(2);
  });
});
