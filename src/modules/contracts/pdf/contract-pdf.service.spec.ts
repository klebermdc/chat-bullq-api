import type { BrowserType } from 'playwright';
import {
  buildContractHtml,
  ContractPdfService,
  paymentLabel,
  PDF_SIGNATURE_ROLE,
  PDF_TAGLINE,
  type ContractPdfInput,
} from './contract-pdf.service';

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

  it('sem aceite não tem bloco de evidência nem imagem de assinatura', () => {
    const html = buildContractHtml(base);
    expect(html).not.toContain('aceite eletrônico');
    expect(html).not.toContain('<img');
  });

  it('com aceite mostra assinatura, data em São Paulo, IP e termos aceitos', () => {
    const html = buildContractHtml(withSignature(PNG_1X1));
    expect(html).toContain('Registro do aceite eletrônico');
    expect(html).toContain('15/10/2026 16:30');
    expect(html).toContain('1.2.3.4');
    expect(html).toContain(`data:image/png;base64,${PNG_1X1}`);
    expect(html).toContain('Termo aceito');
  });

  it('aceite sem assinatura não renderiza imagem', () => {
    expect(buildContractHtml(withSignature(null))).not.toContain('<img');
  });

  it('evidência do aceite vem depois do rodapé de assinaturas', () => {
    const html = buildContractHtml(withSignature(PNG_1X1));
    const sig = html.indexOf('Assinatura do Contratante');
    expect(sig).toBeGreaterThan(-1);
    expect(html.indexOf('Registro do aceite eletrônico')).toBeGreaterThan(sig);
    expect(html.indexOf(`data:image/png;base64,${PNG_1X1}`)).toBeLessThan(sig);
  });

  it('CSP é o primeiro filho do <head>', () => {
    expect(buildContractHtml(base)).toContain(
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    );
  });

  describe('layout do modelo oficial', () => {
    it('cabeçalho com marca, slogan e título', () => {
      const html = buildContractHtml(base);
      expect(PDF_TAGLINE).toBe('A Magia da Disney nas suas mãos');
      expect(html).toContain('<div class="brand">Orlando Fast Pass</div>');
      expect(html).toContain(PDF_TAGLINE);
      expect(html).toContain('CONTRATO DE PRESTAÇÃO DE SERVIÇOS');
    });

    it('moldura dourada repetida em todas as páginas', () => {
      const html = buildContractHtml(base);
      expect(html).toContain('@page{size:A4;margin:0}');
      expect(html).toMatch(/\.frame\{position:fixed;[^}]*border:\d+px solid #D4A520/);
      expect(html).toContain('<div class="frame"></div>');
    });

    it('títulos das 5 seções, com o nome da empresa em maiúsculas e escapado', () => {
      const html = buildContractHtml({ ...base, company: { ...base.company, name: 'Fast <x>' } });
      expect(html).toContain('1. DADOS DO VIAJANTE (CONTRATANTE)');
      expect(html).toContain('2. DADOS DA CONTRATADA (FAST &lt;X&gt;)');
      expect(html).toContain('3. DETALHES DA AVENTURA');
      expect(html).toContain('4. OBSERVAÇÕES E SOLICITAÇÕES');
      expect(html).toContain('5. DIZERES, TERMOS E CONDIÇÕES');
      expect(html).not.toContain('<x>');
    });

    it('quadros com rótulo em negrito e células de 2 colunas', () => {
      const html = buildContractHtml(base);
      expect(html).toContain('<td><b>Cliente:</b> Cliente &lt;b&gt;Teste&lt;/b&gt;</td>');
      expect(html).toContain('<td><b>CPF:</b> 000.000.000-00</td>');
      expect(html).toContain('<td colspan="2"><b>Endereço:</b> Rua A</td>');
      expect(html).toContain('<td colspan="2"><b>CEP:</b> 00000-000</td>');
      expect(html).toContain('<td><b>Razão Social:</b> Orlando Fast Pass</td>');
      expect(html).toContain('<td><b>CNPJ:</b> 33.142.150/0001-99</td>');
      expect(html).toContain('<td><b>Guia Mágico:</b> Kleber</td>');
      expect(html).toContain('<td><b>Pessoas:</b> 2</td>');
      expect(html).toContain('<td><b>Qtd Dias:</b> 1</td>');
      expect(html).toContain('<td colspan="2"><b>Valor Total:</b> R$ 2190,00</td>');
    });

    it('parques em dd/MM - Parque, um por linha, escapados', () => {
      const html = buildContractHtml({
        ...base,
        contract: {
          ...base.contract,
          dates: [
            { label: 'Magic Kingdom', date: '2026-12-11' },
            { label: '<EPCOT>', date: '2026-12-02' },
          ],
        },
      });
      expect(html).toContain('<div>11/12 - Magic Kingdom</div><div>02/12 - &lt;EPCOT&gt;</div>');
    });

    it('sem datas mostra "Datas a definir"', () => {
      const html = buildContractHtml({ ...base, contract: { ...base.contract, dates: [] } });
      expect(html).toContain('<div>Datas a definir</div>');
    });

    it('observações em quadro; vazio vira "Sem observações."', () => {
      expect(buildContractHtml(base)).toContain('<div class="notes">Sem observações.</div>');
      const html = buildContractHtml({ ...base, contract: { ...base.contract, notes: 'Quer <café>' } });
      expect(html).toContain('<div class="notes">Quer &lt;café&gt;</div>');
    });

    it('termos preservam quebras de linha', () => {
      const html = buildContractHtml({ ...base, terms: 'Linha 1\nLinha <2>' });
      expect(html).toContain('<div class="terms">Linha 1\nLinha &lt;2&gt;</div>');
      expect(html).toMatch(/\.terms\{[^}]*white-space:pre-wrap/);
    });

    it('rodapé de assinaturas: cliente em maiúsculas, guia e papel da contratada', () => {
      const html = buildContractHtml({ ...base, contract: { ...base.contract, fullName: 'José <da> Silva' } });
      expect(PDF_SIGNATURE_ROLE).toBe('CONSULTORIA E ESTRATÉGIA MÁGICA');
      expect(html).toContain('<b>Assinatura do Contratante</b>');
      expect(html).toContain('<div class="sig-name">JOSÉ &lt;DA&gt; SILVA</div>');
      expect(html).toContain('<div class="guide-sign">Kleber</div>');
      expect(html).toContain('<b>Orlando Fast Pass</b>');
      expect(html).toContain(`<div class="sig-role">${PDF_SIGNATURE_ROLE}</div>`);
      expect(html).toMatch(/\.signatures\{[^}]*page-break-inside:avoid/);
    });
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
    expect(html).toContain('<td><b>Pagamento:</b> &lt;i&gt;x&lt;/i&gt;</td>');
    expect(html).not.toContain('<i>x</i>');
  });

  it('PDF mostra o rótulo legível', () => {
    const html = buildContractHtml({ ...base, contract: { ...base.contract, paymentMethod: 'cartao-10x' } });
    expect(html).toContain('<td><b>Pagamento:</b> Cartão em 10x</td>');
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
