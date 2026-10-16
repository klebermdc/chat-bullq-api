import { RenderSemaphore } from './render-semaphore';

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
});
