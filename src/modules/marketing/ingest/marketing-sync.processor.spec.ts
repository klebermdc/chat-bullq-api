import { ConfigService } from '@nestjs/config';
import { AdConnectionStatus, AdProvider } from '@prisma/client';
import { MarketingSyncProcessor } from './marketing-sync.processor';
import { CryptoService } from '../../../common/crypto/crypto.service';

const SECRET = 'a'.repeat(64);

function makeCrypto() {
  const config = {
    get: (k: string) => (k === 'KEY_ENCRYPTION_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

/** Fake do Prisma com upsert real sobre a chave (connectionId, date, adId). */
function makeFakePrisma() {
  const stats: any[] = [];
  return {
    stats,
    adDailyStat: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.connectionId_date_adId;
        const found = stats.find(
          (s) =>
            s.connectionId === key.connectionId &&
            s.adId === key.adId &&
            s.date.getTime() === key.date.getTime(),
        );
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const row = { ...create };
        stats.push(row);
        return row;
      }),
    },
  };
}

function makeRepo(connection: any) {
  return {
    connection,
    findOneWithToken: jest.fn(async () => connection),
    markSynced: jest.fn(async () => undefined),
    markFailed: jest.fn(async (_id: string, message: string, status?: AdConnectionStatus) => {
      connection.lastSyncError = message;
      if (status) connection.status = status;
    }),
  };
}

function makeConnection(crypto: CryptoService) {
  return {
    id: 'conn-1',
    organizationId: 'org-1',
    provider: AdProvider.META,
    externalAccountId: 'act_1',
    accessTokenEnc: crypto.encrypt('TOKEN'),
    // Tipados explicitamente (em vez de inferidos): o client Prisma deste
    // projeto gera os enums como objeto `as const`, então `status:
    // AdConnectionStatus.ACTIVE` sem anotação infere o tipo literal
    // `"ACTIVE"` (não `AdConnectionStatus`), e os testes que reatribuem
    // `connection.status`/`connection.lastSyncError` mais abaixo não
    // compilariam.
    status: AdConnectionStatus.ACTIVE as AdConnectionStatus,
    lastSyncError: null as string | null,
  };
}

const RAW_ROW = {
  date_start: '2026-08-10',
  ad_id: '123',
  ad_name: 'Criativo A',
  account_currency: 'BRL',
  spend: '100.00',
  impressions: '5000',
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    data: { connectionId: 'conn-1', since: '2026-08-05', until: '2026-08-12', reason: 'daily', ...overrides },
  } as any;
}

function build(insightsRows: any[] = [RAW_ROW]) {
  const crypto = makeCrypto();
  const connection = makeConnection(crypto);
  const prisma = makeFakePrisma();
  const repo = makeRepo(connection);
  const insights = { fetchAdInsights: jest.fn(async () => insightsRows) };
  const errorReporter = { report: jest.fn() };
  const processor = new MarketingSyncProcessor(
    prisma as any,
    repo as any,
    insights as any,
    crypto,
    errorReporter as any,
  );
  return { processor, prisma, repo, insights, errorReporter, connection };
}

describe('MarketingSyncProcessor', () => {
  it('grava uma linha por anuncio por dia', async () => {
    const { processor, prisma } = build();
    await processor.process(job());
    expect(prisma.stats).toHaveLength(1);
    expect(prisma.stats[0]).toMatchObject({ adId: '123', spend: 100, impressions: 5000 });
  });

  it('rodar duas vezes a mesma janela nao duplica nem soma', async () => {
    const { processor, prisma } = build();
    await processor.process(job());
    await processor.process(job());
    expect(prisma.stats).toHaveLength(1);
    expect(prisma.stats[0].spend).toBe(100);
  });

  it('reprocessar com valor revisado pela Meta atualiza a linha', async () => {
    const { processor, prisma, insights } = build();
    await processor.process(job());
    insights.fetchAdInsights.mockResolvedValueOnce([{ ...RAW_ROW, spend: '137.50' }]);
    await processor.process(job());
    expect(prisma.stats).toHaveLength(1);
    expect(prisma.stats[0].spend).toBe(137.5);
  });

  it('decifra o token antes de chamar a Meta', async () => {
    const { processor, insights } = build();
    await processor.process(job());
    expect(insights.fetchAdInsights).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'TOKEN', adAccountId: 'act_1' }),
    );
  });

  it('marca sincronizado ao terminar', async () => {
    const { processor, repo } = build();
    await processor.process(job());
    expect(repo.markSynced).toHaveBeenCalledWith('conn-1', expect.any(Date));
  });

  it('token morto aposenta a conexao e reporta, sem relancar', async () => {
    const { processor, repo, insights, errorReporter, connection } = build();
    insights.fetchAdInsights.mockRejectedValueOnce({
      response: { data: { error: { code: 190, error_subcode: 463, message: 'Session has expired' } } },
    });

    await expect(processor.process(job())).resolves.toBeUndefined();

    expect(connection.status).toBe(AdConnectionStatus.INVALID_TOKEN);
    expect(repo.markFailed).toHaveBeenCalled();
    expect(errorReporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MARKETING_TOKEN_INVALID', organizationId: 'org-1' }),
    );
  });

  it('inclui o codigo numerico da Meta no contexto do erro', async () => {
    const { processor, insights, errorReporter } = build();
    insights.fetchAdInsights.mockRejectedValueOnce({
      response: { data: { error: { code: 190, error_subcode: 463, message: 'Session has expired' } } },
    });

    await processor.process(job());

    const reported = errorReporter.report.mock.calls[0][0];
    expect(reported.context).toMatchObject({ metaCode: 190 });
  });

  it('limite de requisicao relanca para o BullMQ tentar de novo', async () => {
    const { processor, insights, connection } = build();
    insights.fetchAdInsights.mockRejectedValueOnce({
      response: { data: { error: { code: 17, message: 'User request limit reached' } } },
    });

    await expect(processor.process(job())).rejects.toBeDefined();
    expect(connection.status).toBe(AdConnectionStatus.ACTIVE);
  });

  it('falha passageira grava o erro, reporta e relanca', async () => {
    const { processor, repo, insights, errorReporter } = build();
    insights.fetchAdInsights.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(processor.process(job())).rejects.toBeDefined();
    expect(repo.markFailed).toHaveBeenCalled();
    expect(errorReporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MARKETING_SYNC_FAILED' }),
    );
  });

  it('ignora silenciosamente conexao que sumiu', async () => {
    const { processor, repo, prisma } = build();
    repo.findOneWithToken.mockResolvedValueOnce(null);
    await expect(processor.process(job())).resolves.toBeUndefined();
    expect(prisma.stats).toHaveLength(0);
  });

  it('nao sincroniza conexao desativada', async () => {
    const { processor, repo, insights, connection } = build();
    connection.status = AdConnectionStatus.DISABLED;
    repo.findOneWithToken.mockResolvedValueOnce(connection);
    await processor.process(job());
    expect(insights.fetchAdInsights).not.toHaveBeenCalled();
  });

  it('linha malformada nao derruba o lote inteiro', async () => {
    const { processor, prisma, errorReporter } = build([RAW_ROW, { date_start: '2026-08-10' }]);
    await processor.process(job());
    expect(prisma.stats).toHaveLength(1);
    expect(errorReporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MARKETING_SYNC_FAILED' }),
    );
  });
});
