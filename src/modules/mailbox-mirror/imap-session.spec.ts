import { ImapFlow } from 'imapflow';
import { ImapSessionFactory, pickFolder } from './imap-session';

jest.mock('imapflow', () => ({ ImapFlow: jest.fn() }));

const folders = (items: Array<{ path: string; specialUse?: string }>) => items;

describe('pickFolder', () => {
  it('usa a pasta configurada quando existe', () => {
    expect(pickFolder(folders([{ path: 'INBOX' }, { path: 'Reservas' }]), 'Reservas')).toBe('Reservas');
  });

  it('sem pasta configurada, acha a \\All mesmo com nome traduzido', () => {
    const list = folders([{ path: 'INBOX' }, { path: '[Gmail]/Todos os e-mails', specialUse: '\\All' }]);
    expect(pickFolder(list, null)).toBe('[Gmail]/Todos os e-mails');
  });

  it('sem \\All (outro provedor), cai na INBOX', () => {
    expect(pickFolder(folders([{ path: 'INBOX' }]), null)).toBe('INBOX');
  });

  it('pasta configurada que sumiu também cai na \\All', () => {
    const list = folders([{ path: '[Gmail]/All Mail', specialUse: '\\All' }]);
    expect(pickFolder(list, '[Gmail]/Velha')).toBe('[Gmail]/All Mail');
  });
});

describe('ImapSessionFactory', () => {
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([{ path: 'INBOX' }, { path: '[Gmail]/All Mail', specialUse: '\\All' }]),
    mailboxOpen: jest.fn().mockResolvedValue({ uidValidity: 42n, uidNext: 100 }),
    search: jest.fn().mockResolvedValue([5, 6]),
    fetchOne: jest.fn().mockResolvedValue({ uid: 5, source: Buffer.from('x') }),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    on: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (ImapFlow as unknown as jest.Mock).mockImplementation(() => client);
  });

  it('abre a pasta só para leitura e sem log (a senha nunca vai para o log)', async () => {
    const session = new ImapSessionFactory().create({
      host: 'imap.gmail.com', port: 993, secure: true, user: 'reservas@x.com', password: 'segredo',
    });

    await session.connect();
    const folder = await session.resolveFolder(null);
    const state = await session.open(folder);

    expect(ImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ logger: false, auth: { user: 'reservas@x.com', pass: 'segredo' } }),
    );
    expect(client.mailboxOpen).toHaveBeenCalledWith('[Gmail]/All Mail', { readOnly: true });
    expect(state).toEqual({ uidValidity: 42n, uidNext: 100 });
  });

  it('escuta o evento error (sem ouvinte, o Node derrubaria a API)', () => {
    new ImapSessionFactory().create({ host: 'h', port: 1, secure: true, user: 'u', password: 'p' });
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('busca por UID e baixa a mensagem crua por UID', async () => {
    const session = new ImapSessionFactory().create({
      host: 'h', port: 993, secure: true, user: 'u', password: 'p',
    });

    expect(await session.search({ uid: '10:*' })).toEqual([5, 6]);
    expect(client.search).toHaveBeenCalledWith({ uid: '10:*' }, { uid: true });
    expect(await session.fetchSource(5)).toEqual(Buffer.from('x'));
    expect(client.fetchOne).toHaveBeenCalledWith('5', { uid: true, source: true }, { uid: true });
  });

  it('busca sem resultado vira lista vazia', async () => {
    client.search.mockResolvedValueOnce(false);
    const session = new ImapSessionFactory().create({ host: 'h', port: 1, secure: true, user: 'u', password: 'p' });
    expect(await session.search({ since: new Date() })).toEqual([]);
  });

  it('fechar não lança mesmo se o logout falhar', async () => {
    client.logout.mockRejectedValueOnce(new Error('socket'));
    const session = new ImapSessionFactory().create({ host: 'h', port: 1, secure: true, user: 'u', password: 'p' });
    await expect(session.close()).resolves.toBeUndefined();
  });
});
