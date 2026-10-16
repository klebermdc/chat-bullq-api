/** A fila de espera está cheia: o chamador deve responder "ocupado" na hora. */
export class RenderQueueFullError extends Error {
  constructor() {
    super('Fila do gerador de PDF cheia');
    this.name = 'RenderQueueFullError';
  }
}

/** Esperou na fila mais do que o permitido. */
export class RenderQueueTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`Espera na fila do gerador de PDF excedeu ${waitedMs} ms`);
    this.name = 'RenderQueueTimeoutError';
  }
}

export interface RenderSemaphoreOptions {
  /** Máximo de tarefas esperando; a próxima é rejeitada na hora. Padrão 10. */
  maxQueue?: number;
  /** Tempo máximo esperando na fila; sem valor, espera indefinida. */
  maxWaitMs?: number;
}

const DEFAULT_MAX_QUEUE = 10;

interface Waiter {
  grant: () => void;
  timer?: NodeJS.Timeout;
}

/** Semáforo em memória: no máximo `limit` tarefas rodando; o resto espera numa fila limitada. */
export class RenderSemaphore {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  private readonly maxQueue: number;
  private readonly maxWaitMs?: number;

  constructor(private readonly limit: number, options: RenderSemaphoreOptions = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Limite do semáforo deve ser inteiro ≥ 1');
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    if (!Number.isInteger(this.maxQueue) || this.maxQueue < 0) throw new Error('maxQueue deve ser inteiro ≥ 0');
    this.maxWaitMs = options.maxWaitMs;
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
    if (this.waiting.length >= this.maxQueue) return Promise.reject(new RenderQueueFullError());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { grant: resolve };
      if (this.maxWaitMs != null) {
        const waitedMs = this.maxWaitMs;
        waiter.timer = setTimeout(() => {
          const idx = this.waiting.indexOf(waiter);
          if (idx >= 0) this.waiting.splice(idx, 1);
          reject(new RenderQueueTimeoutError(waitedMs));
        }, waitedMs);
      }
      this.waiting.push(waiter);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.grant(); // a vaga passa direto para o próximo da fila
  }
}
