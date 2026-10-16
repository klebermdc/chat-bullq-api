import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Contract, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../database/prisma.service';
import { readContractDates } from '../domain/park-dates';
import {
  PlanejadorClient,
  PlanejadorConfigError,
  PlanejadorHttpError,
  buildPlanejadorPayload,
} from './planejador.client';

const PASSWORD_LENGTH = 10;
const SETS = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%&*'];
const HTTP_CONFLICT = 409;

const MSG_CONFLICT = 'Login já existe no Planejador para este e-mail';
const MSG_UNAVAILABLE = 'Planejador indisponível (timeout/rede)';
const MSG_NO_PASSWORD = 'Senha do Planejador não pôde ser gravada';

export interface PlanejadorSyncOptions {
  /** Reenviar mesmo já sincronizado (só staff, decidido no controller). */
  force?: boolean;
}

/** O que vai para o banco e para o log de uma falha: nada que venha do cliente ou do Planejador. */
interface FailureInfo {
  message: string;
  status: string;
  code: string;
}

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

function describeFailure(err: unknown): FailureInfo {
  if (err instanceof PlanejadorHttpError) {
    const message = err.status === HTTP_CONFLICT ? MSG_CONFLICT : `Planejador respondeu ${err.status}`;
    return { message, status: String(err.status), code: 'http' };
  }
  if (err instanceof PlanejadorConfigError) return { message: err.message, status: '-', code: 'config' };
  return { message: MSG_UNAVAILABLE, status: '-', code: errorCode(err) };
}

/** Só o nome/código técnico do erro (TimeoutError, ECONNREFUSED...), nunca a mensagem. */
function errorCode(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  const cause = (err as { cause?: { code?: unknown } }).cause;
  const raw = typeof cause?.code === 'string' ? cause.code : err.name;
  return raw.replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown';
}

@Injectable()
export class PlanejadorService {
  private readonly logger = new Logger(PlanejadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly client: PlanejadorClient,
  ) {}

  /**
   * Idempotente e nunca lança: já sincronizado só reenvia com `force`. A senha
   * é gravada antes da chamada externa, então um retry (ou uma corrida com o
   * sync do create) usa sempre a mesma senha.
   */
  async sync(c: Contract, opts: PlanejadorSyncOptions = {}): Promise<void> {
    const force = opts.force === true;
    if (c.planejadorSyncedAt && !force) return;
    try {
      const current = await this.withStoredPassword(c);
      if (!current?.planejadorPasswordEnc) {
        await this.recordFailure(c, force, { message: MSG_NO_PASSWORD, status: '-', code: 'no_password' });
        return;
      }
      const password = this.crypto.decrypt(current.planejadorPasswordEnc);
      try {
        await this.client.createClient(buildPlanejadorPayload(current, readContractDates(current), password));
      } catch (err) {
        await this.recordFailure(c, force, describeFailure(err));
        return;
      }
      await this.prisma.contract.updateMany({
        where: { id: c.id, organizationId: c.organizationId },
        data: { planejadorSyncedAt: new Date(), planejadorError: null },
      });
    } catch (err) {
      this.logger.error(`contract_planejador_sync_error contract=${c.id} code=${errorCode(err)}`);
    }
  }

  async revealPassword(organizationId: string, id: string, scope: Prisma.ContractWhereInput) {
    const c = await this.prisma.contract.findFirst({ where: { id, organizationId, AND: [scope] } });
    if (!c?.planejadorPasswordEnc) throw new NotFoundException('Sem login no Planejador para este contrato');
    return { email: c.email, password: this.crypto.decrypt(c.planejadorPasswordEnc) };
  }

  /**
   * Com senha já gravada, devolve o próprio contrato. Sem senha, grava uma nova
   * só se ainda estiver nula e relê: quem perder a corrida usa a do vencedor.
   */
  private async withStoredPassword(c: Contract): Promise<Contract | null> {
    if (c.planejadorPasswordEnc) return c;
    const where = { id: c.id, organizationId: c.organizationId };
    await this.prisma.contract.updateMany({
      where: { ...where, planejadorPasswordEnc: null },
      data: { planejadorPasswordEnc: this.crypto.encrypt(generatePassword()) },
    });
    return this.prisma.contract.findFirst({ where });
  }

  /**
   * Sem `force`, só grava a falha se ninguém sincronizou no meio tempo (um 409
   * de uma corrida não apaga o sucesso do outro sync).
   */
  private async recordFailure(c: Contract, force: boolean, info: FailureInfo) {
    this.logger.warn(`contract_planejador_failed contract=${c.id} status=${info.status} code=${info.code}`);
    const where = { id: c.id, organizationId: c.organizationId };
    try {
      await this.prisma.contract.updateMany({
        where: force ? where : { ...where, planejadorSyncedAt: null },
        data: { planejadorError: info.message, planejadorSyncedAt: null },
      });
    } catch (err) {
      this.logger.error(`contract_planejador_persist_error contract=${c.id} code=${errorCode(err)}`);
    }
  }
}
