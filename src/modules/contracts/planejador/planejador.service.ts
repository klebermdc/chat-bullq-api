import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Contract, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../database/prisma.service';
import { readContractDates } from '../domain/park-dates';
import { PlanejadorClient, buildPlanejadorPayload } from './planejador.client';

const PASSWORD_LENGTH = 10;
const MAX_STORED_ERROR_CHARS = 300;
const SETS = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*'];

export function generatePassword(length = PASSWORD_LENGTH): string {
  const all = SETS.join('');
  const chars = SETS.map((s) => s[randomInt(s.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

@Injectable()
export class PlanejadorService {
  private readonly logger = new Logger(PlanejadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly client: PlanejadorClient,
  ) {}

  /** Nunca lança: o contrato já foi criado; o erro fica no contrato para tentar de novo. */
  async sync(c: Contract): Promise<void> {
    let password = '';
    try {
      password = c.planejadorPasswordEnc ? this.crypto.decrypt(c.planejadorPasswordEnc) : generatePassword();
      const enc = c.planejadorPasswordEnc ?? this.crypto.encrypt(password);
      try {
        await this.client.createClient(buildPlanejadorPayload(c, readContractDates(c), password));
      } catch (err) {
        await this.recordFailure(c, enc, this.safeReason(err, password), password);
        return;
      }
      await this.prisma.contract.updateMany({
        where: { id: c.id, organizationId: c.organizationId },
        data: { planejadorPasswordEnc: enc, planejadorSyncedAt: new Date(), planejadorError: null },
      });
    } catch (err) {
      this.logger.error(`contract_planejador_sync_error contract=${c.id} reason=${this.safeReason(err, password)}`);
    }
  }

  async revealPassword(organizationId: string, id: string, scope: Prisma.ContractWhereInput) {
    const c = await this.prisma.contract.findFirst({ where: { id, organizationId, AND: [scope] } });
    if (!c?.planejadorPasswordEnc) throw new NotFoundException('Sem login no Planejador para este contrato');
    return { email: c.email, password: this.crypto.decrypt(c.planejadorPasswordEnc) };
  }

  private async recordFailure(c: Contract, enc: string, reason: string, password: string) {
    this.logger.warn(`contract_planejador_failed contract=${c.id} reason=${reason}`);
    try {
      await this.prisma.contract.updateMany({
        where: { id: c.id, organizationId: c.organizationId },
        data: { planejadorPasswordEnc: enc, planejadorError: reason },
      });
    } catch (err) {
      this.logger.error(`contract_planejador_persist_error contract=${c.id} reason=${this.safeReason(err, password)}`);
    }
  }

  /** Mensagem curta e sem a senha, caso o Planejador ecoe o que recebeu. */
  private safeReason(err: unknown, password: string): string {
    const raw = err instanceof Error ? err.message : String(err);
    const clean = password ? raw.split(password).join('[redacted]') : raw;
    return clean.slice(0, MAX_STORED_ERROR_CHARS);
  }
}
