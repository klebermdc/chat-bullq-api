import type { Mailbox } from '@prisma/client';
import type { ImapSession } from './imap-session';
import { MAX_MESSAGES_PER_RUN, MailboxSyncService } from './mailbox-sync.service';

jest.mock('./message-parser', () => ({
  parseRawEmail: jest.fn(async (raw: Buffer) => ({ messageId: `<${raw.toString()}>` })),
}));

const NOW = new Date('2026-11-15T12:00:00Z');

function mailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'mb1',
    organizationId: 'org1',
    address: 'reservas@orlandofastpass.com.br',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    imapUser: 'reservas@orlandofastpass.com.br',
    passwordEnv: 'MAILBOX_RESERVAS_PASSWORD',
    folder: null,
    ignoredDomains: [],
    uidValidity: null,
    lastUid: 0n,
    lastSyncAt: null,
    lastError: null,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function fakeSession(opts: { uidValidity?: bigint; uidNext?: number; found?: number[] } = {}) {
  const session: jest.Mocked<ImapSession> = {
    connect: jest.fn().mockResolvedValue(undefined),
    resolveFolder: jest.fn().mockResolvedValue('[Gmail]/All Mail'),
    open: jest.fn().mockResolvedValue({ uidValidity: opts.uidValidity ?? 777n, uidNext: opts.uidNext ?? 1000 }),
    search: jest.fn().mockResolvedValue(opts.found ?? []),
    fetchSource: jest.fn(async (uid: number) => Buffer.from(`m${uid}`)),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return session;
}

function setup(session: ImapSession, env: Record<string, string> = { MAILBOX_RESERVAS_PASSWORD: 'app-pass' }) {
  const prisma = { mailbox: { update: jest.fn().mockResolvedValue({}) } };
  const config = { get: jest.fn((key: string) => env[key]) };
  const store = { save: jest.fn().mockResolvedValue('created') };
  const sessions = { create: jest.fn().mockReturnValue(session) };
  const service = new MailboxSyncService(prisma as never, config as never, store as never, sessions as never);
  return { prisma, config, store, sessions, service };
}

describe('MailboxSyncService', () => {
  it('sem a senha no ambiente: pula a caixa, grava lastError e nem conecta', async () => {
    const session = fakeSession();
    const { prisma, sessions, service } = setup(session, {});

    const outcome = await service.syncMailbox(mailbox(), NOW);

    expect(outcome.status).toBe('skipped');
    expect(sessions.create).not.toHaveBeenCalled();
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb1' },
      data: { lastError: expect.stringContaining('MAILBOX_RESERVAS_PASSWORD') },
    });
  });

  it('recusa nome de variável fora do padrão (não lê JWT_SECRET para mandar ao IMAP)', async () => {
    const session = fakeSession();
    const { sessions, service } = setup(session, { JWT_SECRET: 'x' });

    const outcome = await service.syncMailbox(mailbox({ passwordEnv: 'JWT_SECRET' }), NOW);

    expect(outcome.status).toBe('skipped');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('primeira vez: busca 12 meses, grava em ordem e salva o cursor com a uidValidity', async () => {
    const session = fakeSession({ found: [30, 10, 20] });
    const { prisma, store, sessions, service } = setup(session);

    const outcome = await service.syncMailbox(mailbox(), NOW);

    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ password: 'app-pass' }));
    expect(session.search).toHaveBeenCalledWith({ since: new Date('2025-11-15T12:00:00Z') });
    expect(store.save.mock.calls.map((c) => c[1])).toEqual([10, 20, 30]);
    expect(outcome).toEqual({ status: 'synced', created: 3, existing: 0, lastUid: 30n });
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb1' },
      data: { uidValidity: 777n, lastUid: 30n },
    });
    expect(prisma.mailbox.update).toHaveBeenLastCalledWith({
      where: { id: 'mb1' },
      data: { lastSyncAt: NOW, lastError: null },
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('incremental: pede UIDs depois do último e ignora o último que o IMAP repete', async () => {
    const session = fakeSession({ found: [500, 501] });
    const { store, service } = setup(session);

    const outcome = await service.syncMailbox(mailbox({ uidValidity: 777n, lastUid: 500n }), NOW);

    expect(session.search).toHaveBeenCalledWith({ uid: '501:*' });
    expect(store.save.mock.calls.map((c) => c[1])).toEqual([501]);
    expect(outcome).toMatchObject({ lastUid: 501n, created: 1 });
  });

  it('uidValidity mudou: relê os 12 meses do zero e conta as já gravadas', async () => {
    const session = fakeSession({ uidValidity: 900n, found: [1, 2] });
    const { store, prisma, service } = setup(session);
    store.save.mockResolvedValue('existing');

    const outcome = await service.syncMailbox(mailbox({ uidValidity: 777n, lastUid: 5000n }), NOW);

    expect(session.search).toHaveBeenCalledWith({ since: expect.any(Date) });
    expect(outcome).toEqual({ status: 'synced', created: 0, existing: 2, lastUid: 2n });
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb1' },
      data: { uidValidity: 900n, lastUid: 2n },
    });
  });

  it('primeira vez sem nada em 12 meses: cursor vai para o fim da pasta', async () => {
    const session = fakeSession({ found: [], uidNext: 4321 });
    const { prisma, service } = setup(session);

    await service.syncMailbox(mailbox(), NOW);

    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb1' },
      data: { uidValidity: 777n, lastUid: 4320n },
    });
  });

  it('salva o cursor a cada lote de 50 e respeita o teto por rodada', async () => {
    const found = Array.from({ length: MAX_MESSAGES_PER_RUN + 20 }, (_, i) => i + 1);
    const session = fakeSession({ found });
    const { prisma, store, service } = setup(session);

    await service.syncMailbox(mailbox(), NOW);

    expect(store.save).toHaveBeenCalledTimes(MAX_MESSAGES_PER_RUN);
    const cursorSaves = prisma.mailbox.update.mock.calls.filter((c) => 'lastUid' in c[0].data);
    expect(cursorSaves).toHaveLength(MAX_MESSAGES_PER_RUN / 50);
    expect(cursorSaves[0][0].data.lastUid).toBe(50n);
  });

  it('falha do IMAP: grava lastError, fecha a sessão e relança', async () => {
    const session = fakeSession();
    session.connect.mockRejectedValue(new Error('AUTHENTICATIONFAILED'));
    const { prisma, service } = setup(session);

    await expect(service.syncMailbox(mailbox(), NOW)).rejects.toThrow('AUTHENTICATIONFAILED');
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb1' },
      data: { lastError: 'AUTHENTICATIONFAILED' },
    });
    expect(session.close).toHaveBeenCalled();
  });

  it('mensagem apagada entre a busca e o download é pulada sem travar o cursor', async () => {
    const session = fakeSession({ found: [7, 8] });
    session.fetchSource.mockResolvedValueOnce(null);
    const { store, service } = setup(session);

    const outcome = await service.syncMailbox(mailbox(), NOW);

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ lastUid: 8n });
  });
});
