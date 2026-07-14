import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

export interface UpsertSonaxInput {
  enabled: boolean;
  idCliente: string;
  token?: string; // ausente = mantém o token atual
  click2callBaseUrl?: string;
}

@Injectable()
export class SonaxSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(organizationId: string) {
    return this.prisma.sonaxSettings.findUnique({ where: { organizationId } });
  }

  async upsert(organizationId: string, input: UpsertSonaxInput) {
    const existing = await this.prisma.sonaxSettings.findUnique({ where: { organizationId } });
    const webhookSecret = existing?.webhookSecret ?? randomBytes(20).toString('hex');
    const tokenEnc = input.token ? this.crypto.encrypt(input.token) : existing?.tokenEnc;
    if (!tokenEnc) {
      throw new Error('Token Sonax obrigatório na primeira configuração');
    }
    return this.prisma.sonaxSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        enabled: input.enabled,
        idCliente: input.idCliente,
        tokenEnc,
        webhookSecret,
        ...(input.click2callBaseUrl ? { click2callBaseUrl: input.click2callBaseUrl } : {}),
      },
      update: {
        enabled: input.enabled,
        idCliente: input.idCliente,
        tokenEnc,
        ...(input.click2callBaseUrl ? { click2callBaseUrl: input.click2callBaseUrl } : {}),
      },
    });
  }

  /** Uso INTERNO (disparo). Nunca exponha o retorno em resposta de API. */
  async getDecryptedForDial(organizationId: string) {
    const s = await this.get(organizationId);
    if (!s || !s.enabled) return null;
    return {
      idCliente: s.idCliente,
      token: this.crypto.decrypt(s.tokenEnc),
      click2callBaseUrl: s.click2callBaseUrl,
    };
  }
}
