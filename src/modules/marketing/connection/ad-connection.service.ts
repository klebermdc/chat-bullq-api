import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdProvider } from '@prisma/client';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { MARKETING_BACKFILL_DAYS, MARKETING_SYNC_WINDOW_DAYS, META_ADS_SCOPES } from '../marketing.constants';
import { MarketingSyncQueue } from '../ingest/marketing-sync.queue';
import { AdConnectionRepository } from './ad-connection.repository';
import { MetaAdAccount, MetaOAuthClient } from './meta-oauth.client';

/** Data no formato YYYY-MM-DD que a Graph API espera. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

@Injectable()
export class AdConnectionService {
  constructor(
    private readonly repo: AdConnectionRepository,
    private readonly oauth: MetaOAuthClient,
    private readonly crypto: CryptoService,
    private readonly queue: MarketingSyncQueue,
  ) {}

  list(organizationId: string) {
    return this.repo.findAllPublic(organizationId);
  }

  /**
   * Passo 1 do fluxo: troca o code e devolve as contas para o usuário escolher.
   * NÃO persiste — se o usuário desistir na tela de escolha, nada fica no banco.
   */
  async listAvailableAccounts(code: string): Promise<MetaAdAccount[]> {
    if (!code?.trim()) throw new BadRequestException('code ausente');
    const { accessToken } = await this.oauth.exchangeCodeForLongLivedToken(code.trim());
    return this.oauth.listAdAccounts(accessToken);
  }

  /** Passo 2: grava a conexão da conta escolhida e dispara o backfill. */
  async createConnection(
    organizationId: string,
    userId: string,
    input: { code: string; adAccountId: string },
  ) {
    if (!input.code?.trim()) throw new BadRequestException('code ausente');
    if (!input.adAccountId?.trim()) throw new BadRequestException('adAccountId ausente');

    const { accessToken, expiresAt } = await this.oauth.exchangeCodeForLongLivedToken(
      input.code.trim(),
    );
    const accounts = await this.oauth.listAdAccounts(accessToken);
    const chosen = accounts.find((a) => a.id === input.adAccountId.trim());
    if (!chosen) {
      throw new BadRequestException(
        'Esta conta de anuncios nao esta acessivel pela conta do Meta conectada',
      );
    }

    const connection = await this.repo.upsert({
      organizationId,
      provider: AdProvider.META,
      externalAccountId: chosen.id,
      accountName: chosen.name,
      currency: chosen.currency,
      timezoneName: chosen.timezoneName,
      businessId: chosen.businessId,
      accessTokenEnc: this.crypto.encrypt(accessToken),
      tokenScopes: [...META_ADS_SCOPES],
      tokenExpiresAt: expiresAt,
      connectedByUserId: userId,
    });

    await this.queue.enqueueSync({
      connectionId: connection.id,
      since: isoDay(daysAgo(MARKETING_BACKFILL_DAYS)),
      until: isoDay(daysAgo(0)),
      reason: 'backfill',
    });

    // Blindagem própria: mesmo que o repositório algum dia devolva a linha
    // crua (sem passar pelo `select` público), o token cifrado nunca sai
    // deste serviço.
    const { accessTokenEnc: _accessTokenEnc, ...publicConnection } = connection as typeof connection & {
      accessTokenEnc?: string;
    };
    return publicConnection;
  }

  async triggerSync(organizationId: string, id: string) {
    const connection = await this.repo.findOnePublic(organizationId, id);
    if (!connection) throw new NotFoundException('Conexao nao encontrada');

    await this.queue.enqueueSync({
      connectionId: id,
      since: isoDay(daysAgo(MARKETING_SYNC_WINDOW_DAYS)),
      until: isoDay(daysAgo(0)),
      reason: 'daily',
    });

    return { message: 'Sincronizacao enfileirada' };
  }

  async remove(organizationId: string, id: string) {
    const { count } = await this.repo.delete(organizationId, id);
    if (count === 0) throw new NotFoundException('Conexao nao encontrada');
    // Os fatos históricos em ad_daily_stats ficam de propósito: o relatório do
    // mês passado não pode sumir porque alguém desconectou a conta hoje.
    return { message: 'Conexao removida' };
  }
}
