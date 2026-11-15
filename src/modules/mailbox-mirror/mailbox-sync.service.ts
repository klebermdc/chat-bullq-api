import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Mailbox } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ImapSession, ImapSessionFactory } from './imap-session';
import { parseRawEmail } from './message-parser';
import { MessageStoreService } from './message-store.service';
import { chunk, cursorAfterEmptyScan, pendingUids, planSync, SyncPlan } from './sync-plan';

export const SYNC_BATCH_SIZE = 50;
/** Teto por rodada: a importação inicial de 12 meses anda em várias rodadas de 5 min. */
export const MAX_MESSAGES_PER_RUN = 500;
const MAX_ERROR_LENGTH = 500;

/**
 * Só aceita nomes no formato MAILBOX_<X>_PASSWORD. Quem edita a linha da
 * caixa no banco não consegue apontar para JWT_SECRET e mandar o segredo
 * para um servidor IMAP qualquer.
 */
const PASSWORD_ENV_PATTERN = /^MAILBOX_[A-Z0-9_]+_PASSWORD$/;

export type SyncOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'synced'; created: number; existing: number; lastUid: bigint };

@Injectable()
export class MailboxSyncService {
  private readonly logger = new Logger(MailboxSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly store: MessageStoreService,
    private readonly sessions: ImapSessionFactory,
  ) {}

  /** Uma rodada de uma caixa. Falha de IMAP/banco grava lastError e relança. */
  async syncMailbox(mailbox: Mailbox, now = new Date()): Promise<SyncOutcome> {
    const password = this.resolvePassword(mailbox.passwordEnv);
    if (!password) {
      const reason = PASSWORD_ENV_PATTERN.test(mailbox.passwordEnv)
        ? `Senha não configurada: defina a variável de ambiente ${mailbox.passwordEnv}.`
        : `Nome de variável inválido em password_env (use MAILBOX_<NOME>_PASSWORD).`;
      await this.recordError(mailbox.id, reason);
      return { status: 'skipped', reason };
    }
    const session = this.sessions.create({
      host: mailbox.imapHost,
      port: mailbox.imapPort,
      secure: mailbox.imapSecure,
      user: mailbox.imapUser,
      password,
    });
    try {
      const outcome = await this.runSession(mailbox, session, now);
      await this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { lastSyncAt: now, lastError: null },
      });
      return outcome;
    } catch (err) {
      await this.recordError(mailbox.id, err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      await session.close();
    }
  }

  private resolvePassword(envName: string): string | null {
    if (!PASSWORD_ENV_PATTERN.test(envName)) return null;
    return this.config.get<string>(envName)?.trim() || null;
  }

  private async runSession(mailbox: Mailbox, session: ImapSession, now: Date): Promise<SyncOutcome> {
    await session.connect();
    const folder = await session.resolveFolder(mailbox.folder);
    const state = await session.open(folder);
    const plan = planSync({ uidValidity: mailbox.uidValidity, lastUid: mailbox.lastUid }, state.uidValidity, now);
    if (plan.mode !== 'incremental') {
      this.logger.log(`caixa ${mailbox.id}: leitura ${plan.mode} da pasta "${folder}"`);
    }
    const uids = pendingUids(await session.search(plan.search), plan.afterUid, MAX_MESSAGES_PER_RUN);
    if (uids.length === 0) {
      const lastUid = cursorAfterEmptyScan(plan.mode, plan.afterUid, state.uidNext);
      await this.saveCursor(mailbox.id, state.uidValidity, lastUid);
      return { status: 'synced', created: 0, existing: 0, lastUid };
    }
    return this.importBatches(mailbox, session, plan, state.uidValidity, uids);
  }

  /** Lotes de 50; o cursor é salvo a cada lote para não refazer trabalho se cair no meio. */
  private async importBatches(
    mailbox: Mailbox,
    session: ImapSession,
    plan: SyncPlan,
    uidValidity: bigint,
    uids: number[],
  ): Promise<SyncOutcome> {
    const totals = { created: 0, existing: 0, lastUid: plan.afterUid };
    for (const batch of chunk(uids, SYNC_BATCH_SIZE)) {
      for (const uid of batch) {
        const result = await this.importOne(mailbox, session, uid);
        if (result === 'created') totals.created += 1;
        if (result === 'existing') totals.existing += 1;
      }
      totals.lastUid = BigInt(batch[batch.length - 1]);
      await this.saveCursor(mailbox.id, uidValidity, totals.lastUid);
    }
    this.logger.log(
      `caixa ${mailbox.id}: ${totals.created} novas, ${totals.existing} já gravadas, último UID ${totals.lastUid}`,
    );
    return { status: 'synced', ...totals };
  }

  private async importOne(mailbox: Mailbox, session: ImapSession, uid: number) {
    const source = await session.fetchSource(uid);
    // Apagada entre a busca e o download: nada a fazer.
    if (!source) return 'gone' as const;
    const parsed = await this.parseOrSkip(mailbox.id, uid, source);
    // Mensagem que nem o parser entende não pode travar o cursor para sempre.
    if (!parsed) return 'unparseable' as const;
    return this.store.save(mailbox, uid, parsed);
  }

  private async parseOrSkip(mailboxId: string, uid: number, source: Buffer) {
    try {
      return await parseRawEmail(source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`caixa ${mailboxId}: UID ${uid} ilegível, pulado (${msg})`);
      return null;
    }
  }

  private async saveCursor(mailboxId: string, uidValidity: bigint, lastUid: bigint): Promise<void> {
    await this.prisma.mailbox.update({ where: { id: mailboxId }, data: { uidValidity, lastUid } });
  }

  private async recordError(mailboxId: string, message: string): Promise<void> {
    try {
      await this.prisma.mailbox.update({
        where: { id: mailboxId },
        data: { lastError: message.slice(0, MAX_ERROR_LENGTH) },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`não consegui gravar lastError da caixa ${mailboxId}: ${msg}`);
    }
  }
}
