import { RenderQueueFullError, RenderQueueTimeoutError, RenderSemaphore } from './render-semaphore';

const flush = () => new Promise((r) => setImmediate(r));

describe('RenderSemaphore', () => {
  it('rejeita limite inválido', () => {
    expect(() => new RenderSemaphore(0)).toThrow();
  });

  it('a 3ª chamada espera até uma das 2 liberar', async () => {
    const sem = new RenderSemaphore(2);
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const task = (n: number) =>
      sem.run(
        () =>
          new Promise<number>((resolve) => {
            started.push(n);
            releases.push(() => resolve(n));
          }),
      );

    const p1 = task(1);
    const p2 = task(2);
    const p3 = task(3);
    await flush();
    expect(started).toEqual([1, 2]);

    releases[0]();
    await expect(p1).resolves.toBe(1);
    await flush();
    expect(started).toEqual([1, 2, 3]);

    releases[1]();
    releases[2]();
    await expect(Promise.all([p2, p3])).resolves.toEqual([2, 3]);
  });

  it('libera a vaga mesmo quando a tarefa falha', async () => {
    const sem = new RenderSemaphore(1);
    await expect(sem.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(sem.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('libera a vaga quando a tarefa lança de forma síncrona', async () => {
    const sem = new RenderSemaphore(1);
    await expect(
      sem.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    await expect(sem.run(() => Promise.resolve(1))).resolves.toBe(1);
  });

  describe('fila limitada', () => {
    const hold = (sem: RenderSemaphore) => sem.run(() => new Promise<void>(() => undefined));

    it('com 2 rodando e 10 na fila, a 13ª rejeita na hora', async () => {
      const sem = new RenderSemaphore(2);
      for (let k = 0; k < 12; k += 1) void hold(sem);
      await flush();
      await expect(hold(sem)).rejects.toBeInstanceOf(RenderQueueFullError);
    });

    it('maxQueue é configurável e a fila andando libera espaço', async () => {
      const sem = new RenderSemaphore(1, { maxQueue: 1 });
      let release!: () => void;
      const first = sem.run(() => new Promise<void>((r) => (release = r)));
      const second = sem.run(() => Promise.resolve('b'));
      await expect(sem.run(() => Promise.resolve('c'))).rejects.toBeInstanceOf(RenderQueueFullError);
      release();
      await first;
      await expect(second).resolves.toBe('b');
      await expect(sem.run(() => Promise.resolve('d'))).resolves.toBe('d');
    });

    it('espera na fila além de maxWaitMs rejeita e sai da fila', async () => {
      jest.useFakeTimers();
      try {
        const sem = new RenderSemaphore(1, { maxQueue: 1, maxWaitMs: 25_000 });
        void hold(sem);
        const waiter = sem.run(() => Promise.resolve('x'));
        const assertion = expect(waiter).rejects.toBeInstanceOf(RenderQueueTimeoutError);
        await jest.advanceTimersByTimeAsync(25_000);
        await assertion;
        // a vaga na fila foi devolvida: outro pode entrar na fila sem erro de fila cheia
        const again = sem.run(() => Promise.resolve('y'));
        const again2 = expect(again).rejects.toBeInstanceOf(RenderQueueTimeoutError);
        await jest.advanceTimersByTimeAsync(25_000);
        await again2;
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
