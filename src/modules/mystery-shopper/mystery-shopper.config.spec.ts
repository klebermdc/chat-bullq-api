import { isViewer, readMysteryShopperSettings } from './mystery-shopper.config';

describe('readMysteryShopperSettings', () => {
  test('sem configuração = ninguém vê e nada é enviado', () => {
    expect(readMysteryShopperSettings({})).toEqual({ viewerEmails: [], telegramChatIds: [] });
    expect(readMysteryShopperSettings(null)).toEqual({ viewerEmails: [], telegramChatIds: [] });
  });

  test('normaliza e-mails e aceita chat do Telegram como número', () => {
    const settings = readMysteryShopperSettings({
      mysteryShopper: { viewerEmails: [' Admin@OrlandoFastPass.com.br ', 3, ''], telegramChatIds: [123, '456', null] },
    });
    expect(settings).toEqual({
      viewerEmails: ['admin@orlandofastpass.com.br'],
      telegramChatIds: ['123', '456'],
    });
  });
});

describe('isViewer', () => {
  const settings = { viewerEmails: ['admin@orlandofastpass.com.br'], telegramChatIds: [] };

  test('só o e-mail da lista, sem diferenciar maiúsculas', () => {
    expect(isViewer(settings, 'ADMIN@orlandofastpass.com.br')).toBe(true);
    expect(isViewer(settings, 'kleber@orlandofastpass.com.br')).toBe(false);
    expect(isViewer(settings, undefined)).toBe(false);
  });
});
