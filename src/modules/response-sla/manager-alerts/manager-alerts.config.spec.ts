import { parseManagerAlertsConfig } from './manager-alerts.config';

const VALID = {
  channelId: 'cmrl1cahe002kny07shsi7px4',
  recipients: [
    { name: 'Renata', phone: '5511947156251' },
    { name: 'Rafael', phone: '+55 (11) 96614-4493' },
  ],
  digestAfterMinutes: 30,
  digestIntervalMinutes: 30,
  scoreboardTime: '22:10',
  digestTemplate: 'alerta_sla_gestao',
  scoreboardTemplate: 'placar_sla_dia',
  language: 'pt_BR',
};

const settings = (alerts: unknown, sla: unknown = 15) => ({
  responseSlaMinutes: sla,
  slaManagerAlerts: alerts,
});

describe('parseManagerAlertsConfig', () => {
  it('aceita a config completa e normaliza o telefone para dígitos', () => {
    const result = parseManagerAlertsConfig(settings(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.recipients).toEqual([
      { name: 'Renata', phone: '5511947156251' },
      { name: 'Rafael', phone: '5511966144493' },
    ]);
    expect(result.config.scoreboardMinutes).toBe(22 * 60 + 10);
    expect(result.config.digestTemplate).toBe('alerta_sla_gestao');
  });

  it('aplica padrões nos campos opcionais', () => {
    const result = parseManagerAlertsConfig(
      settings({ channelId: 'c1', recipients: [{ name: 'Ana', phone: '5511999998888' }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      digestAfterMinutes: 30,
      digestIntervalMinutes: 30,
      scoreboardMinutes: 22 * 60 + 10,
      digestTemplate: 'alerta_sla_gestao',
      scoreboardTemplate: 'placar_sla_dia',
      language: 'pt_BR',
    });
  });

  it('fica desligado (sem motivo) quando a chave não existe', () => {
    expect(parseManagerAlertsConfig({ responseSlaMinutes: 15 })).toEqual({
      ok: false,
      reason: null,
    });
    expect(parseManagerAlertsConfig(null)).toEqual({ ok: false, reason: null });
  });

  it('exige o SLA de resposta ligado', () => {
    const result = parseManagerAlertsConfig(settings(VALID, null));
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('responseSlaMinutes') });
  });

  it.each([
    ['sem canal', { ...VALID, channelId: '' }],
    ['sem destinatários', { ...VALID, recipients: [] }],
    ['telefone inválido', { ...VALID, recipients: [{ name: 'X', phone: '123' }] }],
    ['nome vazio', { ...VALID, recipients: [{ name: ' ', phone: '5511999998888' }] }],
    ['minutos negativos', { ...VALID, digestAfterMinutes: -5 }],
    ['intervalo texto', { ...VALID, digestIntervalMinutes: '30' }],
    ['horário inválido', { ...VALID, scoreboardTime: '25:99' }],
    ['template vazio', { ...VALID, digestTemplate: '' }],
    ['não é objeto', 'ligado'],
  ])('fica desligado com motivo quando %s', (_label, alerts) => {
    const result = parseManagerAlertsConfig(settings(alerts));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual(expect.any(String));
  });
});
