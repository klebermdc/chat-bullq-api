import { NfseDeliveryWatcher, NfseUndeliveredError, undeliveredReason } from './nfse-delivery-watcher';

function watcher(statuses: Array<Array<{ status: string; failedReason?: string | null }>>) {
  const findMany = jest.fn();
  for (const rows of statuses) findMany.mockResolvedValueOnce(rows);
  findMany.mockResolvedValue(statuses[statuses.length - 1]);
  const w = new NfseDeliveryWatcher({ message: { findMany } } as any);
  const sleep = jest.fn().mockResolvedValue(undefined);
  return { w, findMany, sleep };
}

describe('NfseDeliveryWatcher.waitOutcome', () => {
  it('throws with the WhatsApp reason when a message comes back FAILED', async () => {
    const { w, sleep } = watcher([
      [{ status: 'SENT' }],
      [{ status: 'FAILED', failedReason: '[131026] Message undeliverable: Message undeliverable' }],
    ]);

    const outcome = w.waitOutcome(['m1'], { waitMs: 10_000, pollMs: 500, sleep });

    await expect(outcome).rejects.toBeInstanceOf(NfseUndeliveredError);
    await expect(w.waitOutcome(['m1'], { waitMs: 10_000, pollMs: 500, sleep })).rejects.toThrow('131026');
  });

  it('returns true as soon as every message is delivered', async () => {
    const { w, findMany, sleep } = watcher([[{ status: 'SENT' }, { status: 'DELIVERED' }], [{ status: 'READ' }, { status: 'DELIVERED' }]]);

    const delivered = await w.waitOutcome(['m1', 'm2'], { waitMs: 10_000, pollMs: 500, sleep });

    expect(delivered).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('returns false when nothing failed before the wait ran out', async () => {
    const { w, sleep } = watcher([[{ status: 'SENT' }]]);

    const delivered = await w.waitOutcome(['m1'], { waitMs: 1_000, pollMs: 500, sleep });

    expect(delivered).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('undeliveredReason', () => {
  it('explains the "undeliverable" code', () => {
    expect(undeliveredReason('[131026] Message undeliverable: Message undeliverable')).toMatch(
      /^Número sem WhatsApp.*\[131026\]/,
    );
  });

  it('keeps an unknown reason as it is', () => {
    expect(undeliveredReason('[999] Outra coisa')).toBe('[999] Outra coisa');
  });

  it('has a default when the reason is empty', () => {
    expect(undeliveredReason(null)).toBe('O WhatsApp não entregou a mensagem.');
  });
});
