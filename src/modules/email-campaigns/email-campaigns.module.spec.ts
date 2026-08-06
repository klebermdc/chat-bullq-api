import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { TagsModule } from '../tags/tags.module';
import { TagsService } from '../tags/tags.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { CAMPAIGN_SEND_QUEUE } from './email-campaigns.constants';
import { EmailCampaignsModule } from './email-campaigns.module';

/**
 * Prova que o Nest consegue montar o grafo de DI do módulo — o único tipo de
 * teste que pega um parâmetro de construtor IRRESOLVÍVEL (interface que some
 * em runtime, ex.: `config?: EmailConfig`). Foi esse defeito, sem
 * `@Optional()`, que derrubou a API em produção em 2026-08-04. Testes
 * unitários que instanciam a classe à mão nunca pegam isso.
 *
 * `EmailCampaignsModule` importa `EmailCoreModule` e `EmailAudienceModule`
 * inteiros — este é o módulo mais "pesado" dos três, então herda os mesmos
 * dublês dos outros dois specs (`createTestingModule` não herda `@Global()`):
 * `NotificationsModule` (via `EmailCoreModule`), `TagsModule` (via
 * `EmailAudienceModule`) e `ChannelAccessService` (exigido por `OrgGuard`
 * em todo controller).
 */
@Module({
  providers: [
    { provide: NotificationsService, useValue: { notify: jest.fn(), notifyOrgAgents: jest.fn() } },
  ],
  exports: [NotificationsService],
})
class FakeNotificationsModule {}

@Module({
  providers: [{ provide: TagsService, useValue: { findOne: jest.fn() } }],
  exports: [TagsService],
})
class FakeTagsModule {}

@Global()
@Module({
  providers: [{ provide: ChannelAccessService, useValue: {} }],
  exports: [ChannelAccessService],
})
class FakeChannelAccessModule {}

describe('EmailCampaignsModule (compilação Nest)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      RESEND_API_KEY: 'test_key',
      RESEND_WEBHOOK_SECRET: 'test_webhook_secret',
      EMAIL_FROM: 'no-reply@teste.com',
      EMAIL_UNSUBSCRIBE_SECRET: 'test_unsubscribe_secret',
      APP_PUBLIC_URL: 'https://app.teste.com',
      API_PUBLIC_URL: 'https://api.teste.com',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('resolve todas as dependências e compila', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, FakeChannelAccessModule, EmailCampaignsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
      .overrideModule(TagsModule)
      .useModule(FakeTagsModule)
      // `BullModule.registerQueue` cria uma `Queue` real, que tenta conectar
      // no Redis de verdade assim que instanciada — sem `BullModule.forRoot`
      // (só existe na raiz do app real), o `.compile()` trava esperando essa
      // conexão em vez de falhar rápido. Dublê evita a rede inteira. (A fila
      // `notifications` não precisa de override próprio aqui: trocar
      // `NotificationsModule` inteiro por `FakeNotificationsModule` já a tira
      // do grafo — `registerQueue` dela nunca chega a ser processado.)
      .overrideProvider(getQueueToken(CAMPAIGN_SEND_QUEUE))
      .useValue({})
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
