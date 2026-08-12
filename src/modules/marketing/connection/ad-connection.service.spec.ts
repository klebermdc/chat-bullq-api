import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdConnectionStatus, AdProvider } from '@prisma/client';
import { AdConnectionService } from './ad-connection.service';
import { CryptoService } from '../../../common/crypto/crypto.service';

const SECRET = 'a'.repeat(64);
const ORG = 'org-1';

function makeCrypto() {
  const config = {
    get: (k: string) => (k === 'KEY_ENCRYPTION_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

function makeRepo() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findAllPublic: jest.fn(async (organizationId: string) =>
      rows.filter((r) => r.organizationId === organizationId),
    ),
    findOnePublic: jest.fn(async (organizationId: string, id: string) =>
      rows.find((r) => r.id === id && r.organizationId === organizationId) ?? null,
    ),
    upsert: jest.fn(async (data: any) => {
      const existing = rows.find(
        (r) =>
          r.organizationId === data.organizationId &&
          r.externalAccountId === data.externalAccountId,
      );
      let row: any;
      if (existing) {
        Object.assign(existing, data, { status: AdConnectionStatus.ACTIVE });
        row = existing;
      } else {
        row = { id: `c${++seq}`, status: AdConnectionStatus.ACTIVE, ...data };
        rows.push(row);
      }
      // Espelha o `select: CONNECTION_PUBLIC_SELECT` do repositório real: o
      // token cifrado fica gravado na linha, mas nunca sai do upsert.
      const { accessTokenEnc: _accessTokenEnc, ...publicRow } = row;
      return publicRow;
    }),
    delete: jest.fn(async (organizationId: string, id: string) => {
      const i = rows.findIndex((r) => r.id === id && r.organizationId === organizationId);
      if (i >= 0) rows.splice(i, 1);
      return { count: i >= 0 ? 1 : 0 };
    }),
  };
}

function makeOauth(accounts: any[] = [{ id: 'act_1', name: 'Conta 1', currency: 'BRL', timezoneName: 'America/Sao_Paulo', businessId: 'biz-1' }]) {
  return {
    exchangeCodeForLongLivedToken: jest.fn(async () => ({
      accessToken: 'TOKEN-LONGO',
      expiresAt: new Date('2026-10-01T00:00:00Z'),
    })),
    listAdAccounts: jest.fn(async () => accounts),
  };
}

function makeQueue() {
  return { enqueueSync: jest.fn(async () => undefined) };
}

function makeHandshakes() {
  const map = new Map<string, any>();
  let seq = 0;
  return {
    map,
    save: jest.fn(async (payload: any) => {
      const id = `hs${++seq}`;
      map.set(id, payload);
      return id;
    }),
    consume: jest.fn(async (id: string) => {
      const found = map.get(id) ?? null;
      map.delete(id);
      return found;
    }),
  };
}

function build(overrides: { oauth?: any; repo?: any; queue?: any; handshakes?: any } = {}) {
  const repo = overrides.repo ?? makeRepo();
  const oauth = overrides.oauth ?? makeOauth();
  const queue = overrides.queue ?? makeQueue();
  const handshakes = overrides.handshakes ?? makeHandshakes();
  const service = new AdConnectionService(
    repo as any,
    oauth as any,
    makeCrypto(),
    queue as any,
    handshakes as any,
  );
  return { service, repo, oauth, queue, handshakes };
}

/** Passo 1 + passo 2, como um cliente real faria. */
async function connect(service: any, adAccountId = 'act_1') {
  const { handshakeId } = await service.listAvailableAccounts('CODE');
  return service.createConnection(ORG, 'user-1', { handshakeId, adAccountId });
}

describe('AdConnectionService', () => {
  it('lista as contas disponiveis sem persistir nada', async () => {
    const { service, repo } = build();
    const { accounts } = await service.listAvailableAccounts('CODE');
    expect(accounts).toHaveLength(1);
    expect(repo.rows).toHaveLength(0);
  });

  it('recusa code vazio', async () => {
    const { service } = build();
    await expect(service.listAvailableAccounts('  ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria a conexao com o token cifrado e nunca devolve o token', async () => {
    const { service, repo } = build();
    const created = await connect(service);

    expect(created).not.toHaveProperty('accessTokenEnc');
    const stored = repo.rows[0];
    expect(stored.accessTokenEnc).toBeDefined();
    expect(stored.accessTokenEnc).not.toContain('TOKEN-LONGO');
    expect(makeCrypto().decrypt(stored.accessTokenEnc)).toBe('TOKEN-LONGO');
  });

  it('recusa ad account que o token nao enxerga', async () => {
    const { service } = build();
    await expect(connect(service, 'act_999')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa adAccountId vazio', async () => {
    const { service } = build();
    const { handshakeId } = await service.listAvailableAccounts('CODE');
    await expect(
      service.createConnection(ORG, 'user-1', { handshakeId, adAccountId: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enfileira o backfill ao conectar', async () => {
    const { service, queue } = build();
    await connect(service);
    expect(queue.enqueueSync).toHaveBeenCalledTimes(1);
    const arg = queue.enqueueSync.mock.calls[0][0];
    expect(arg.reason).toBe('backfill');
  });

  it('reconectar a mesma conta reativa em vez de duplicar', async () => {
    const { service, repo } = build();
    await connect(service);
    repo.rows[0].status = AdConnectionStatus.INVALID_TOKEN;
    repo.rows[0].lastSyncError = 'Session has expired';

    await connect(service);

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].status).toBe(AdConnectionStatus.ACTIVE);
  });

  it('grava o provider META', async () => {
    const { service, repo } = build();
    await connect(service);
    expect(repo.rows[0].provider).toBe(AdProvider.META);
  });

  it('sync manual enfileira com reason daily', async () => {
    const { service, repo, queue } = build();
    await connect(service);
    queue.enqueueSync.mockClear();

    await service.triggerSync(ORG, repo.rows[0].id);

    expect(queue.enqueueSync).toHaveBeenCalledTimes(1);
    expect(queue.enqueueSync.mock.calls[0][0].reason).toBe('daily');
  });

  it('sync manual de conexao de outra org da 404', async () => {
    const { service, repo } = build();
    await connect(service);
    await expect(service.triggerSync('org-2', repo.rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remover conexao de outra org da 404', async () => {
    const { service, repo } = build();
    await connect(service);
    await expect(service.remove('org-2', repo.rows[0].id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.rows).toHaveLength(1);
  });

  it('list delega para o repositorio', async () => {
    const { service, repo } = build();
    await service.list(ORG);
    expect(repo.findAllPublic).toHaveBeenCalledWith(ORG);
  });

  it('troca o code UMA vez so — createConnection nao chama a Meta de novo', async () => {
    const { service, oauth } = build();
    await connect(service);
    expect(oauth.exchangeCodeForLongLivedToken).toHaveBeenCalledTimes(1);
    expect(oauth.listAdAccounts).toHaveBeenCalledTimes(1);
  });

  it('handshake serve uma vez so', async () => {
    const { service } = build();
    const { handshakeId } = await service.listAvailableAccounts('CODE');
    await service.createConnection(ORG, 'user-1', { handshakeId, adAccountId: 'act_1' });
    await expect(
      service.createConnection(ORG, 'user-1', { handshakeId, adAccountId: 'act_1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('handshake expirado ou desconhecido da erro claro', async () => {
    const { service } = build();
    await expect(
      service.createConnection(ORG, 'user-1', { handshakeId: 'nao-existe', adAccountId: 'act_1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
