import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { TagsModule } from '../tags/tags.module';
import { TagsService } from '../tags/tags.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { EmailCoreModule } from './email-core.module';

/**
 * Prova que o Nest consegue montar o grafo de DI do módulo — o único tipo de
 * teste que pega um parâmetro de construtor IRRESOLVÍVEL (ex.: `config?:
 * EmailConfig`, uma interface, que some em runtime e faz o Nest tentar
 * resolver o token `Object`). Foi exatamente esse defeito, sem `@Optional()`,
 * que derrubou a API em produção em 2026-08-04 — "Nest can't resolve
 * dependencies of ResendClient (index 0)". Testes unitários que instanciam a
 * classe à mão nunca pegam isso, porque `new ResendClient()` não passa pelo
 * reflection de metadata do Nest.
 *
 * `createTestingModule` NÃO herda módulos `@Global()` — mesmo em produção
 * eles só existem porque o AppModule os importa uma vez na raiz. Aqui
 * `NotificationsModule` (pelo `ResendWebhookController`) e `TagsModule`
 * (transitivo, via `EmailAudienceModule`) puxam dependências de fora do
 * domínio de email — `NotificationsModule` arrasta `RealtimeGateway` (de
 * `RealtimeModule`, outro `@Global()`) e `TagsModule` arrasta `OrgGuard` do
 * seu controller (que por sua vez exige `ChannelAccessService`). Os dois
 * módulos inteiros são trocados por dublês via `overrideModule` — não dá
 * para isolar só o serviço com `overrideProvider`, porque o Nest instancia
 * TODOS os providers/controllers declarados no módulo, usados ou não.
 */
@Module({
  providers: [
    {
      provide: NotificationsService,
      useValue: { notify: jest.fn(), notifyOrgAgents: jest.fn() },
    },
  ],
  exports: [NotificationsService],
})
class FakeNotificationsModule {}

@Module({
  providers: [{ provide: TagsService, useValue: { findOne: jest.fn() } }],
  exports: [TagsService],
})
class FakeTagsModule {}

/**
 * `OrgGuard` (aplicado a todo controller autenticado via `@UseGuards`) exige
 * `ChannelAccessService`, de `ChannelAccessModule` — outro `@Global()` não
 * herdado aqui. Precisa ser `@Global()` também: um provider comum só fica
 * visível para quem importa o módulo que o declara, e nada aqui importa
 * `ChannelAccessModule` de propósito (ele arrasta `RealtimeGateway` pelos
 * próprios controllers). `@Global()` replica o mesmo mecanismo que o torna
 * disponível em toda a app real.
 */
@Global()
@Module({
  providers: [{ provide: ChannelAccessService, useValue: {} }],
  exports: [ChannelAccessService],
})
class FakeChannelAccessModule {}

describe('EmailCoreModule (compilação Nest)', () => {
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
      imports: [PrismaModule, FakeChannelAccessModule, EmailCoreModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
      .overrideModule(TagsModule)
      .useModule(FakeTagsModule)
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
