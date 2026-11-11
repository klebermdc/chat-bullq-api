import { parseManagerBotConfig } from './manager-bot.config';

describe('parseManagerBotConfig', () => {
  it('fica desligado sem motivo quando managerBot não existe', () => {
    expect(parseManagerBotConfig({})).toEqual({ ok: false, reason: null });
    expect(parseManagerBotConfig(null)).toEqual({ ok: false, reason: null });
  });

  it('fica desligado sem motivo quando enabled não é true', () => {
    expect(parseManagerBotConfig({ managerBot: { enabled: false } })).toEqual({ ok: false, reason: null });
  });

  it('aplica os padrões e aceita lista de chats vazia (fase de cadastro)', () => {
    const parsed = parseManagerBotConfig({ managerBot: { enabled: true, linkCode: 'abc123' } });
    expect(parsed).toEqual({
      ok: true,
      config: {
        chats: [],
        linkCode: 'abc123',
        openingMinutes: 540,
        closingMinutes: 1330,
        slaAlertAfterMinutes: 30,
        alertIntervalMinutes: 30,
        queueThreshold: 10,
        offlineMinutes: 30,
      },
    });
  });

  it('normaliza chatId numérico para texto', () => {
    const parsed = parseManagerBotConfig({
      managerBot: { enabled: true, chats: [{ chatId: 123456, name: 'Kleber' }] },
    });
    expect(parsed.ok && parsed.config.chats).toEqual([{ chatId: '123456', name: 'Kleber' }]);
  });

  it('recusa chat sem nome ou com id inválido', () => {
    const parsed = parseManagerBotConfig({ managerBot: { enabled: true, chats: [{ chatId: 'x', name: '' }] } });
    expect(parsed).toEqual({ ok: false, reason: 'chats com id ou nome inválido' });
  });

  it('recusa horário fora do formato HH:MM', () => {
    const parsed = parseManagerBotConfig({ managerBot: { enabled: true, closingTime: '25:00' } });
    expect(parsed).toEqual({ ok: false, reason: 'closingMinutes inválido' });
  });

  it('recusa número não positivo', () => {
    const parsed = parseManagerBotConfig({ managerBot: { enabled: true, queueThreshold: 0 } });
    expect(parsed).toEqual({ ok: false, reason: 'queueThreshold inválido' });
  });
});
