import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdProvider } from '@prisma/client';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { MARKETING_BACKFILL_DAYS, MARKETING_SYNC_WINDOW_DAYS, META_ADS_SCOPES } from '../marketing.constants';
import { MarketingSyncQueue } from '../ingest/marketing-sync.queue';
import { AdConnectionRepository } from './ad-connection.repository';
import { MetaAdAccount, MetaOAuthClient } from './meta-oauth.client';
import { OAuthHandshakeStore } from './oauth-handshake.store';

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
    private readonly handshakes: OAuthHandshakeStore,
  ) {}

  list(organizationId: string) {
    return this.repo.findAllPublic(organizationId);
  }

  /**
   * Passo 1 do fluxo: troca o code e devolve as contas para o usuário escolher.
   *
   * O `code` do OAuth é de uso único (RFC 6749 §4.1.2) — não dá para guardá-lo
   * e trocar de novo no passo 2. Por isso a troca acontece aqui, uma vez só, e
   * o resultado (token cifrado + contas) fica num handshake de curta duração
   * no servidor. Nada é persistido no banco: se o usuário desistir na tela de
   * escolha, o handshake expira sozinho e nada fica no banco.
   */
  async listAvailableAccounts(
    code: string,
  ): Promise<{ handshakeId: string; accounts: MetaAdAccount[] }> {
    if (!code?.trim()) throw new BadRequestException('code ausente');
    const { accessToken, expiresAt } = await this.oauth.exchangeCodeForLongLivedToken(
      code.trim(),
    );
    const accounts = await this.oauth.listAdAccounts(accessToken);

    const handshakeId = await this.handshakes.save({
      tokenEnc: this.crypto.encrypt(accessToken),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      accounts,
    });

    return { handshakeId, accounts };
  }

  /**
   * Passo 2: consome o handshake do passo 1 (uma vez só) e grava a conexão da
   * conta escolhida. Não fala com a Meta de novo — o token já foi trocado.
   */
  async createConnection(
    organizationId: string,
    userId: string,
    input: { handshakeId: string; adAccountId: string },
  ) {
    if (!input.handshakeId?.trim()) throw new BadRequestException('handshakeId ausente');
    if (!input.adAccountId?.trim()) throw new BadRequestException('adAccountId ausente');

    const handshake = await this.handshakes.consume(input.handshakeId.trim());
    if (!handshake) {
      throw new BadRequestException('Sessao de conexao expirada — refaca o login com o Meta');
    }

    const chosen = handshake.accounts.find((a) => a.id === input.adAccountId.trim());
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
      accessTokenEnc: handshake.tokenEnc,
      tokenScopes: [...META_ADS_SCOPES],
      tokenExpiresAt: handshake.expiresAt ? new Date(handshake.expiresAt) : null,
      connectedByUserId: userId,
    });

    await this.queue.enqueueSync({
      connectionId: connection.id,
      since: isoDay(daysAgo(MARKETING_BACKFILL_DAYS)),
      until: isoDay(daysAgo(0)),
      reason: 'backfill',
    });

    return connection;
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
