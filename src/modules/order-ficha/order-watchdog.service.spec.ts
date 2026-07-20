import { OrderWatchdogService } from './order-watchdog.service';

describe('OrderWatchdogService.sweep', () => {
  const now = new Date('2026-07-21T12:00:00Z');
  const stale = {
    organizationId: 'o1',
    conversationId: 'cv1',
    requestedAt: new Date('2026-07-20T00:00:00Z'),
    divergences: [],
  };
  let repo: any;
  let alert: any;
  let settings: any;
  let convos: any;
  let svc: OrderWatchdogService;

  beforeEach(() => {
    repo = {
      findDelayCandidates: jest.fn().mockResolvedValue([stale]),
      updateDivergences: jest.fn(),
    };
    alert = { raise: jest.fn() };
    settings = { delayHoursFor: jest.fn().mockResolvedValue(24) };
    convos = { channelIdFor: jest.fn().mockResolvedValue('ch1') };
    svc = new OrderWatchdogService(repo, alert, settings, convos);
  });

  it('alerta demora quando passou do prazo e sem proposal', async () => {
    await svc.sweep(now);
    expect(alert.raise).toHaveBeenCalledWith('cv1', 'ch1', [
      expect.objectContaining({ kind: 'DELAY_NO_CART' }),
    ]);
  });

  it('não alerta se ainda dentro do prazo', async () => {
    repo.findDelayCandidates.mockResolvedValue([
      { ...stale, requestedAt: new Date('2026-07-21T06:00:00Z') },
    ]); // 6h < 24h
    await svc.sweep(now);
    expect(alert.raise).not.toHaveBeenCalled();
  });

  it('não realerta se já existe DELAY_NO_CART na ficha', async () => {
    repo.findDelayCandidates.mockResolvedValue([
      { ...stale, divergences: [{ kind: 'DELAY_NO_CART' }] },
    ]);
    await svc.sweep(now);
    expect(alert.raise).not.toHaveBeenCalled();
  });

  it('isola erro por candidato: se o 1º falhar, o 2º ainda é processado', async () => {
    const candidate1 = { ...stale, conversationId: 'cv1' };
    const candidate2 = { ...stale, conversationId: 'cv2' };
    repo.findDelayCandidates.mockResolvedValue([candidate1, candidate2]);
    alert.raise = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await svc.sweep(now);

    expect(alert.raise).toHaveBeenCalledTimes(2);
    expect(alert.raise).toHaveBeenNthCalledWith(1, 'cv1', 'ch1', [
      expect.objectContaining({ kind: 'DELAY_NO_CART' }),
    ]);
    expect(alert.raise).toHaveBeenNthCalledWith(2, 'cv2', 'ch1', [
      expect.objectContaining({ kind: 'DELAY_NO_CART' }),
    ]);
    expect(repo.updateDivergences).toHaveBeenCalledTimes(2);
  });
});
