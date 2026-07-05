import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Criptografia simétrica (AES-256-GCM) para segredos guardados no banco.
 * Formato de saída: base64(iv).base64(authTag).base64(ciphertext)
 */
@Injectable()
export class CryptoService {
  private static readonly ALGO = 'aes-256-gcm';

  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const hex = this.config.get<string>('KEY_ENCRYPTION_SECRET');
    if (!hex || hex.length !== 64) {
      throw new InternalServerErrorException(
        'KEY_ENCRYPTION_SECRET ausente ou inválida (esperado 64 chars hex)',
      );
    }
    return Buffer.from(hex, 'hex');
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(CryptoService.ALGO, this.key(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ctB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !ctB64) {
      throw new InternalServerErrorException('Payload criptografado inválido');
    }
    const decipher = crypto.createDecipheriv(
      CryptoService.ALGO,
      this.key(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  }

  /** Máscara para exibir na UI, ex.: "gsk_…12345". */
  preview(plain: string): string {
    const head = plain.slice(0, 4);
    const tail = plain.slice(-5);
    return `${head}…${tail}`;
  }
}
