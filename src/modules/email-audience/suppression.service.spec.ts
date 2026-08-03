import { EmailSubscriberStatus } from '@prisma/client';
import { SuppressionService } from './suppression.service';

const service = new SuppressionService();

describe('canReceive', () => {
  it('libera quem está inscrito', () => {
    expect(service.canReceive({ status: EmailSubscriberStatus.SUBSCRIBED } as any).allowed).toBe(true);
  });

  it.each([
    [EmailSubscriberStatus.UNSUBSCRIBED, /descadastr/i],
    [EmailSubscriberStatus.BOUNCED, /bounce/i],
    [EmailSubscriberStatus.COMPLAINED, /spam/i],
  ])('bloqueia %s explicando o motivo', (status, re) => {
    const v = service.canReceive({ status } as any);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(re as RegExp);
  });

  it('bloqueia destinatário inexistente', () => {
    expect(service.canReceive(null).allowed).toBe(false);
  });
});

describe('statusForBounce', () => {
  it('bounce permanente suprime', () => {
    expect(service.statusForBounce('hard')).toBe(EmailSubscriberStatus.BOUNCED);
    expect(service.statusForBounce('Permanent')).toBe(EmailSubscriberStatus.BOUNCED);
  });

  it('bounce temporário NÃO suprime — caixa cheia volta a funcionar', () => {
    expect(service.statusForBounce('soft')).toBeNull();
    expect(service.statusForBounce('Transient')).toBeNull();
  });

  it('tipo desconhecido é tratado como temporário', () => {
    expect(service.statusForBounce(undefined)).toBeNull();
    expect(service.statusForBounce('qualquer-coisa')).toBeNull();
  });
});
