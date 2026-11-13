import { decideCall, decidePermissionRequest, parseVoiceCallSettings } from './outreach.rules';

const H = 3600_000;
const now = new Date('2026-11-16T15:00:00-03:00');

describe('parseVoiceCallSettings', () => {
  it('vem DESLIGADO por padrão (settings vazio, inválido ou sem a chave)', () => {
    expect(parseVoiceCallSettings({})).toEqual({ enabled: false, delayHours: 24 });
    expect(parseVoiceCallSettings(null)).toEqual({ enabled: false, delayHours: 24 });
    expect(parseVoiceCallSettings({ voiceCalls: 'sim' })).toEqual({ enabled: false, delayHours: 24 });
  });

  it('só liga com enabled === true; prazo entre 1 e 168 horas', () => {
    expect(parseVoiceCallSettings({ voiceCalls: { enabled: true, delayHours: 48 } })).toEqual({ enabled: true, delayHours: 48 });
    expect(parseVoiceCallSettings({ voiceCalls: { enabled: 'true' } }).enabled).toBe(false);
    expect(parseVoiceCallSettings({ voiceCalls: { enabled: true, delayHours: 500 } }).delayHours).toBe(24);
  });
});

describe('decidePermissionRequest', () => {
  const base = { proposalCreatedAt: new Date(now.getTime() - 10 * 60_000), windowOpen: true, alreadyRequested: false, optedOut: false };

  it('pede logo depois da cotação, com a janela aberta', () => {
    expect(decidePermissionRequest({ ...base, now })).toEqual({ action: 'PEDIR' });
  });

  it('não pede: janela fechada, já pedido, cliente não quer ligação ou cotação velha', () => {
    expect(decidePermissionRequest({ ...base, now, windowOpen: false })).toEqual({ action: 'PULAR', reason: 'JANELA_FECHADA' });
    expect(decidePermissionRequest({ ...base, now, alreadyRequested: true })).toEqual({ action: 'PULAR', reason: 'JA_PEDIDO' });
    expect(decidePermissionRequest({ ...base, now, optedOut: true })).toEqual({ action: 'PULAR', reason: 'NAO_LIGAR' });
    expect(decidePermissionRequest({ ...base, now, proposalCreatedAt: new Date(now.getTime() - 2 * H) })).toEqual({ action: 'PULAR', reason: 'COTACAO_ANTIGA' });
  });
});

describe('decideCall', () => {
  const base = {
    now,
    delayHours: 24,
    proposalCreatedAt: new Date(now.getTime() - 25 * H),
    lastInboundAt: new Date(now.getTime() - 30 * H),
    hasOwner: true,
    withinHours: true,
    optedOut: false,
    alreadyCalled: false,
  };

  it('liga 24h depois da cotação sem resposta, no expediente, com vendedor', () => {
    expect(decideCall(base)).toEqual({ action: 'LIGAR' });
  });

  it('espera antes do prazo e fora do expediente', () => {
    expect(decideCall({ ...base, proposalCreatedAt: new Date(now.getTime() - 20 * H) })).toEqual({ action: 'ESPERAR', reason: 'ANTES_DO_PRAZO' });
    expect(decideCall({ ...base, withinHours: false })).toEqual({ action: 'ESPERAR', reason: 'FORA_DO_EXPEDIENTE' });
  });

  it('pula: cliente respondeu depois da cotação, sem vendedor, não quer ligação, já ligou ou passou do prazo', () => {
    expect(decideCall({ ...base, lastInboundAt: new Date(now.getTime() - 2 * H) })).toEqual({ action: 'PULAR', reason: 'CLIENTE_RESPONDEU' });
    expect(decideCall({ ...base, hasOwner: false })).toEqual({ action: 'PULAR', reason: 'SEM_VENDEDOR' });
    expect(decideCall({ ...base, optedOut: true })).toEqual({ action: 'PULAR', reason: 'NAO_LIGAR' });
    expect(decideCall({ ...base, alreadyCalled: true })).toEqual({ action: 'PULAR', reason: 'JA_LIGOU' });
    expect(decideCall({ ...base, proposalCreatedAt: new Date(now.getTime() - 80 * H), lastInboundAt: new Date(now.getTime() - 90 * H) })).toEqual({ action: 'PULAR', reason: 'PASSOU_DO_PRAZO' });
  });
});
