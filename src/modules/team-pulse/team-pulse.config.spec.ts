import { parseTeamPulseConfig } from './team-pulse.config';

const VALID = {
  channelId: 'cmrl1cahe002kny07shsi7px4',
  recipients: [{ name: 'Renata', phone: '+55 (11) 94715-6251' }],
};

describe('parseTeamPulseConfig', () => {
  it('fica desligado (sem motivo) quando a chave teamPulse não existe', () => {
    // Arrange / Act
    const result = parseTeamPulseConfig({ responseSlaMinutes: 15 });
    // Assert
    expect(result).toEqual({ ok: false, reason: null });
  });

  it('aplica os padrões e normaliza o telefone para dígitos', () => {
    const result = parseTeamPulseConfig({ teamPulse: VALID });
    expect(result).toEqual({
      ok: true,
      config: {
        channelId: VALID.channelId,
        recipients: [{ name: 'Renata', phone: '5511947156251' }],
        hourlyTemplate: 'pulso_atendimento',
        closingTemplate: 'fechamento_atendimento',
        language: 'pt_BR',
        closingHour: 22,
      },
    });
  });

  it('aceita templates, idioma e hora de fechamento próprios', () => {
    const result = parseTeamPulseConfig({
      teamPulse: { ...VALID, hourlyTemplate: 'pulso_v2', closingTemplate: 'fecha_v2', language: 'pt_BR', closingHour: 21 },
    });
    expect(result.ok && result.config).toMatchObject({
      hourlyTemplate: 'pulso_v2',
      closingTemplate: 'fecha_v2',
      closingHour: 21,
    });
  });

  it('não exige o SLA de resposta ligado', () => {
    expect(parseTeamPulseConfig({ teamPulse: VALID }).ok).toBe(true);
  });

  it.each([
    ['não é objeto', 'sim'],
    ['sem channelId', { recipients: VALID.recipients }],
    ['sem destinatários', { channelId: 'c1', recipients: [] }],
    ['telefone curto', { channelId: 'c1', recipients: [{ name: 'Renata', phone: '1234' }] }],
    ['hora de fechamento fora do dia', { ...VALID, closingHour: 24 }],
    ['hora de fechamento quebrada', { ...VALID, closingHour: 21.5 }],
    ['template vazio', { ...VALID, hourlyTemplate: '  ' }],
  ])('desliga com motivo quando %s', (_label, raw) => {
    const result = parseTeamPulseConfig({ teamPulse: raw });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toEqual(expect.any(String));
  });
});
