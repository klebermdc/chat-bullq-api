import { ResendWebhookThrottleGuard } from './resend-webhook-throttle.guard';

function ctxForIp(ip: string): any {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, ip }),
    }),
  };
}

describe('ResendWebhookThrottleGuard', () => {
  it('libera requisições dentro do limite', () => {
    const guard = new ResendWebhookThrottleGuard();
    for (let i = 0; i < 60; i++) {
      expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(true);
    }
  });

  it('bloqueia depois de estourar o limite na janela', () => {
    const guard = new ResendWebhookThrottleGuard();
    for (let i = 0; i < 60; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'));
    }
    expect(guard.canActivate(ctxForIp('1.2.3.4'))).toBe(false);
  });

  it('IPs diferentes têm contadores independentes', () => {
    const guard = new ResendWebhookThrottleGuard();
    for (let i = 0; i < 60; i++) {
      guard.canActivate(ctxForIp('1.2.3.4'));
    }
    expect(guard.canActivate(ctxForIp('5.6.7.8'))).toBe(true);
  });
});
