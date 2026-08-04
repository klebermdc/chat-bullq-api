import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { TagsModule } from '../tags/tags.module';
import { TagsService } from '../tags/tags.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { EmailAudienceModule } from './email-audience.module';

/**
 * Prova que o Nest consegue montar o grafo de DI do módulo — o único tipo de
 * teste que pega um parâmetro de construtor IRRESOLVÍVEL (interface que some
 * em runtime, ex.: `config?: EmailConfig`). Foi esse defeito, sem
 * `@Optional()`, que derrubou a API em produção em 2026-08-04. Testes
 * unitários que instanciam a classe à mão nunca pegam isso.
 *
 * `createTestingModule` NÃO herda módulos `@Global()` — mesmo em produção
 * eles só existem porque o AppModule os importa uma vez na raiz. Aqui:
 *  - `TagsModule` (importado por este módulo para as etiquetas de
 *    destinatário) traz `TagsController`, que exige `OrgGuard`, que exige
 *    `ChannelAccessService` — dublê direto no lugar do módulo inteiro,
 *    porque `TagsService` de verdade (via `OutboxService`) puxaria
 *    `AutomationsModule` inteiro.
 *  - `SubscribersController` também usa `OrgGuard` — mesmo
 *    `ChannelAccessService`, resolvido por um módulo `@Global()` fake.
 */
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

describe('EmailAudienceModule (compilação Nest)', () => {
  it('resolve todas as dependências e compila', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, FakeChannelAccessModule, EmailAudienceModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideModule(TagsModule)
      .useModule(FakeTagsModule)
      .compile();

    expect(moduleRef).toBeDefined();
  });
});
