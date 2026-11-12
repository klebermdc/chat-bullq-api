import { RenderService } from './render.service';

function makeFakeBrowser(text: string) {
  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    innerText: jest.fn().mockResolvedValue(text),
  };
  const browser = {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { browser, page };
}

describe('RenderService', () => {
  it('navega, espera o delay, lê o texto e fecha o browser', async () => {
    const { browser, page } = makeFakeBrowser('CARRINHO RENDERIZADO');
    const launch = jest.fn().mockResolvedValue(browser);
    const service = new RenderService({ launch } as any);

    const text = await service.render('https://exemplo/checkout/abc', 5);

    expect(page.goto).toHaveBeenCalledWith(
      'https://exemplo/checkout/abc',
      expect.objectContaining({ waitUntil: 'load' }),
    );
    expect(page.waitForTimeout).toHaveBeenCalledWith(5);
    expect(text).toBe('CARRINHO RENDERIZADO');
    expect(browser.close).toHaveBeenCalled();
  });

  it('fecha o browser mesmo se a navegação falhar', async () => {
    const { browser, page } = makeFakeBrowser('x');
    page.goto.mockRejectedValue(new Error('boom'));
    const launch = jest.fn().mockResolvedValue(browser);
    const service = new RenderService({ launch } as any);

    await expect(
      service.render('https://exemplo/checkout/abc', 5),
    ).rejects.toThrow('boom');
    expect(browser.close).toHaveBeenCalled();
  });
});

describe('RenderService.renderWhenText', () => {
  function fakeBrowserWithWait(text: string) {
    const { browser, page } = makeFakeBrowser(text);
    const withWait = { ...page, waitForFunction: jest.fn().mockResolvedValue(undefined) };
    const launch = jest.fn().mockResolvedValue({ ...browser, newPage: jest.fn().mockResolvedValue(withWait) });
    return { browser, page: withWait, service: new RenderService({ launch } as any) };
  }

  it('espera o texto aparecer na página (sem networkidle), lê o body e fecha o browser', async () => {
    const { browser, page, service } = fakeBrowserWithWait('Total do pedido\nR$ 10,00');

    const text = await service.renderWhenText('https://loja/pt/checkout/abc', /Total do pedido\s*R\$/, 30_000);

    expect(page.goto).toHaveBeenCalledWith(
      'https://loja/pt/checkout/abc',
      expect.objectContaining({ waitUntil: 'load' }),
    );
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      { source: 'Total do pedido\\s*R\\$', flags: '' },
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(text).toBe('Total do pedido\nR$ 10,00');
    expect(browser.close).toHaveBeenCalled();
  });

  it('a função de espera testa o padrão contra o texto do body', async () => {
    const { page, service } = fakeBrowserWithWait('x');
    await service.renderWhenText('https://loja/pt/checkout/abc', /Total do pedido\s*R\$/i, 1);
    const [predicate, arg] = page.waitForFunction.mock.calls[0];
    const original = (globalThis as any).document;

    (globalThis as any).document = { body: { innerText: 'total do pedido\nR$ 5' } };
    expect(predicate(arg)).toBe(true);
    (globalThis as any).document = { body: { innerText: 'carregando...' } };
    expect(predicate(arg)).toBe(false);
    (globalThis as any).document = original;
  });

  it('fecha o browser quando o texto não aparece a tempo', async () => {
    const { browser, page, service } = fakeBrowserWithWait('x');
    page.waitForFunction.mockRejectedValue(new Error('Timeout 30000ms exceeded'));

    await expect(service.renderWhenText('https://loja/pt/checkout/abc', /x/, 30_000)).rejects.toThrow('Timeout');
    expect(page.innerText).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
});
