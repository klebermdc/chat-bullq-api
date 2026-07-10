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
      expect.objectContaining({ waitUntil: 'networkidle' }),
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
