/** Semáforo em memória: no máximo `limit` tarefas rodando ao mesmo tempo; o resto espera em fila. */
export class RenderSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Limite do semáforo deve ser inteiro ≥ 1');
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); // a vaga passa direto para o próximo da fila
    else this.active -= 1;
  }
}
