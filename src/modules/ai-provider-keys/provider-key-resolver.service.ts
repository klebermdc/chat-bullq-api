import { Injectable } from '@nestjs/common';
import { AiCapability, AiProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

export interface ResolvedProviderKey {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const ENV_FALLBACK: Record<AiCapability, { provider: AiProvider; keyEnv: string; baseUrlEnv?: string }> = {
  TRANSCRIPTION: { provider: 'GROQ', keyEnv: 'GROQ_API_KEY' },
  EMBEDDINGS: { provider: 'OPENAI', keyEnv: 'OPENAI_API_KEY' },
  AGENT_LLM: { provider: 'SAKANA', keyEnv: 'SAKANA_API_KEY', baseUrlEnv: 'SAKANA_BASE_URL' },
};

@Injectable()
export class ProviderKeyResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async resolve(orgId: string, capability: AiCapability): Promise<ResolvedProviderKey | null> {
    const row = await this.prisma.aiProviderKey.findFirst({
      where: { organizationId: orgId, capabilities: { has: capability } },
      orderBy: { updatedAt: 'desc' },
      select: { provider: true, encryptedKey: true, baseUrl: true, model: true },
    });
    if (row) {
      return {
        provider: row.provider,
        apiKey: this.crypto.decrypt(row.encryptedKey),
        baseUrl: row.baseUrl ?? undefined,
        model: row.model ?? undefined,
      };
    }
    const fb = ENV_FALLBACK[capability];
    const envKey = this.config.get<string>(fb.keyEnv);
    if (!envKey) return null;
    return {
      provider: fb.provider,
      apiKey: envKey,
      baseUrl: fb.baseUrlEnv ? this.config.get<string>(fb.baseUrlEnv) ?? undefined : undefined,
      model: undefined,
    };
  }
}
