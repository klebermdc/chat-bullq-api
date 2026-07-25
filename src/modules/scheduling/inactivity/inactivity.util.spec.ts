import { ballIsWithClient, computeBand, isEligibleForReengage } from './inactivity.util';

describe('inactivity.util', () => {
  const t = (iso: string) => new Date(iso);

  describe('ballIsWithClient', () => {
    it('true quando última é outbound e sem inbound depois', () => {
      expect(ballIsWithClient(t('2026-01-01T10:00:00Z'), null)).toBe(true);
      expect(ballIsWithClient(t('2026-01-02T10:00:00Z'), t('2026-01-01T10:00:00Z'))).toBe(true);
    });
    it('false quando cliente respondeu por último ou nunca houve outbound', () => {
      expect(ballIsWithClient(t('2026-01-01T10:00:00Z'), t('2026-01-02T10:00:00Z'))).toBe(false);
      expect(ballIsWithClient(null, t('2026-01-01T10:00:00Z'))).toBe(false);
      expect(ballIsWithClient(null, null)).toBe(false);
    });
  });

  describe('computeBand', () => {
    const bands = [3, 7, 15, 30];
    const now = t('2026-01-31T00:00:00Z');
    it('retorna null se a bola não está com o cliente', () => {
      expect(computeBand({ lastOutboundAt: t('2026-01-01T00:00:00Z'), lastInboundAt: t('2026-01-30T00:00:00Z'), bandsDays: bands, now })).toBeNull();
    });
    it('classifica pela faixa de dias parado', () => {
      // 1 dia parado → abaixo da 1ª faixa → índice -1? Usamos null quando < bands[0]
      expect(computeBand({ lastOutboundAt: t('2026-01-30T00:00:00Z'), lastInboundAt: null, bandsDays: bands, now })).toBeNull();
      // 5 dias → faixa índice 0 (3-7)
      expect(computeBand({ lastOutboundAt: t('2026-01-26T00:00:00Z'), lastInboundAt: null, bandsDays: bands, now })).toBe(0);
      // 20 dias → faixa índice 2 (15-30)
      expect(computeBand({ lastOutboundAt: t('2026-01-11T00:00:00Z'), lastInboundAt: null, bandsDays: bands, now })).toBe(2);
      // 40 dias → última faixa índice 3 (30+)
      expect(computeBand({ lastOutboundAt: t('2025-12-22T00:00:00Z'), lastInboundAt: null, bandsDays: bands, now })).toBe(3);
    });
    it('unit=HOURS classifica pela faixa de horas parado', () => {
      const hb = [3, 6, 12, 24];
      const nowH = t('2026-01-02T00:00:00Z');
      // 2h parado → abaixo da 1ª faixa (3h) → null
      expect(computeBand({ lastOutboundAt: t('2026-01-01T22:00:00Z'), lastInboundAt: null, bandsDays: hb, now: nowH, unit: 'HOURS' })).toBeNull();
      // 5h → faixa índice 0 (3-6h)
      expect(computeBand({ lastOutboundAt: t('2026-01-01T19:00:00Z'), lastInboundAt: null, bandsDays: hb, now: nowH, unit: 'HOURS' })).toBe(0);
      // 13h → faixa índice 2 (12-24h)
      expect(computeBand({ lastOutboundAt: t('2026-01-01T11:00:00Z'), lastInboundAt: null, bandsDays: hb, now: nowH, unit: 'HOURS' })).toBe(2);
    });
    it('sem unit assume DAYS (mesmo resultado de antes)', () => {
      expect(computeBand({ lastOutboundAt: t('2026-01-26T00:00:00Z'), lastInboundAt: null, bandsDays: bands, now })).toBe(0);
    });
  });

  describe('isEligibleForReengage', () => {
    it('elegível quando band >= reengageFromBand', () => {
      expect(isEligibleForReengage(2, 1)).toBe(true);
      expect(isEligibleForReengage(1, 1)).toBe(true);
      expect(isEligibleForReengage(0, 1)).toBe(false);
      expect(isEligibleForReengage(null, 1)).toBe(false);
    });
  });
});
