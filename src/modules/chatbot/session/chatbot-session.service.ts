import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChatbotSession } from './chatbot-session.types';

@Injectable()
export class ChatbotSessionService {
  private readonly logger = new Logger(ChatbotSessionService.name);
  private readonly redis: Redis;
  private readonly TTL = 86400; // 24h

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    });
  }

  private key(conversationId: string): string {
    return `bot:session:${conversationId}`;
  }

  async get(conversationId: string): Promise<ChatbotSession | null> {
    const raw = await this.redis.get(this.key(conversationId));
    return raw ? JSON.parse(raw) : null;
  }

  async create(conversationId: string, flowId: string, startNodeId: string): Promise<ChatbotSession> {
    const session: ChatbotSession = {
      flowId,
      conversationId,
      currentNodeId: startNodeId,
      variables: {},
      waitingForInput: false,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    await this.redis.setex(this.key(conversationId), this.TTL, JSON.stringify(session));
    return session;
  }

  async update(conversationId: string, updates: Partial<ChatbotSession>): Promise<ChatbotSession | null> {
    const session = await this.get(conversationId);
    if (!session) return null;
    const updated = { ...session, ...updates, lastActivityAt: new Date().toISOString() };
    await this.redis.setex(this.key(conversationId), this.TTL, JSON.stringify(updated));
    return updated;
  }

  async setVariable(conversationId: string, name: string, value: any): Promise<void> {
    const session = await this.get(conversationId);
    if (!session) return;
    session.variables[name] = value;
    session.lastActivityAt = new Date().toISOString();
    await this.redis.setex(this.key(conversationId), this.TTL, JSON.stringify(session));
  }

  async destroy(conversationId: string): Promise<void> {
    await this.redis.del(this.key(conversationId));
  }

  async exists(conversationId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(conversationId))) === 1;
  }

  private lockKey(conversationId: string): string {
    return `bot:lock:${conversationId}`;
  }

  /**
   * Mutex por conversa (Redis SET NX PX + release via Lua com compare-and-del),
   * mesmo padrão do IdempotencyService. Serializa o processamento do bot: sem
   * isso, o ChatbotProcessor (concurrency:5) rodava 2 mensagens do mesmo contato
   * em paralelo, get→setex não-atômico da sessão → reenvio de nós e double-advance
   * do fluxo. Se não conseguir a trava dentro de timeoutMs, lança (o job do
   * chatbot tem attempts:3, então re-tenta e pega a trava quando a outra soltar).
   */
  async withConversationLock<T>(
    conversationId: string,
    fn: () => Promise<T>,
    opts: { ttlMs?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const ttlMs = opts.ttlMs ?? 30_000;
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const key = this.lockKey(conversationId);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const start = Date.now();

    while (true) {
      const res = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
      if (res === 'OK') break;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(
          `Timeout adquirindo lock do chatbot p/ conversa ${conversationId}`,
        );
      }
      await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 60)));
    }

    try {
      return await fn();
    } finally {
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redis.eval(script, 1, key, token);
      } catch (err: any) {
        this.logger.warn(
          `Release do lock do chatbot falhou p/ ${conversationId}: ${err.message}`,
        );
      }
    }
  }
}
