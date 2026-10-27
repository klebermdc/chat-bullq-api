import { Injectable, Logger } from '@nestjs/common';
import type { Channel } from '@prisma/client';
import { WhatsAppOfficialHttpClient } from '../../channel-hub/adapters/whatsapp-official/whatsapp-official.http-client';
import { HOUR_MS, PHONE_MAX_DIGITS, PHONE_MIN_DIGITS } from './quote.constants';

export type SellerChannel = Pick<Channel, 'id' | 'type' | 'config'>;

/** Chaves aceitas na config do canal para o número (cadastro manual). */
const CONFIG_PHONE_KEYS = ['displayPhoneNumber', 'phoneNumber', 'phone'] as const;
const CACHE_TTL_MS = HOUR_MS;
/** Sem número (ou Meta fora): tenta de novo antes, para não esconder o botão por 1h. */
const MISS_TTL_MS = 5 * 60 * 1000;

export function toWhatsappDigits(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS ? digits : null;
}

/**
 * Número do canal da conversa (o da empresa, que vai no wa.me da página).
 * O canal não guarda o número: no WhatsApp oficial ele vem da Meta
 * (`display_phone_number`) e fica em cache por 1h (5 min quando não veio), porque a página pública é
 * aberta várias vezes. Sem número, `null`: a página troca o botão por
 * "Responda a mensagem no WhatsApp".
 */
@Injectable()
export class SellerWhatsappService {
  private readonly logger = new Logger(SellerWhatsappService.name);
  private readonly cache = new Map<string, { value: string | null; expiresAt: number }>();

  constructor(private readonly waOfficial: WhatsAppOfficialHttpClient) {}

  async resolve(channel: SellerChannel | null): Promise<string | null> {
    if (!channel) return null;
    const fromConfig = this.fromConfig(channel);
    if (fromConfig) return fromConfig;
    if (channel.type !== 'WHATSAPP_OFFICIAL') return null;

    const cached = this.cache.get(channel.id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.fromMeta(channel);
    const ttl = value ? CACHE_TTL_MS : MISS_TTL_MS;
    this.cache.set(channel.id, { value, expiresAt: Date.now() + ttl });
    return value;
  }

  private fromConfig(channel: SellerChannel): string | null {
    const config = (channel.config ?? {}) as Record<string, unknown>;
    for (const key of CONFIG_PHONE_KEYS) {
      const digits = toWhatsappDigits(config[key]);
      if (digits) return digits;
    }
    return null;
  }

  private async fromMeta(channel: SellerChannel): Promise<string | null> {
    try {
      const info = await this.waOfficial.verifyPhoneNumber(channel as Channel);
      return toWhatsappDigits(info?.display_phone_number);
    } catch (err) {
      this.logger.warn(`quote_seller_phone_failed channel=${channel.id}: ${(err as Error).message}`);
      return null;
    }
  }
}
