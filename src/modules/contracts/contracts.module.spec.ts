import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { ResendClient } from '../email-core/resend.client';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { ContractFilesService } from './contract-files.service';
import { ContractsController } from './contracts.controller';
import { ContractsModule } from './contracts.module';
import { ContractsService } from './contracts.service';
import { ContractsImportController } from './legacy/contracts-import.controller';
import { ContractNotifierService } from './notify/contract-notifier.service';
import { ContractPdfService } from './pdf/contract-pdf.service';
import { ContractAcceptanceService } from './public/contract-acceptance.service';
import { PublicContractsController } from './public/public-contracts.controller';

/**
 * Prova que o Nest monta o grafo de DI do ContractsModule (pega construtor
 * irresolvível, que teste unitário com `new` não pega).
 *
 * `createTestingModule` não herda os módulos `@Global()` do AppModule
 * (PrismaModule, StorageModule, RealtimeModule, ChannelAccessModule). Os
 * providers que o módulo usa vêm de um módulo global falso: PrismaService,
 * StorageService e RealtimeGateway pelos services, e ChannelAccessService
 * pelo OrgGuard dos controllers.
 *
 * O ResendClient real lê as variáveis de e-mail no construtor e falha sem
 * elas; aqui ele é trocado por um dublê.
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: StorageService, useValue: {} },
    { provide: RealtimeGateway, useValue: { emitToOrg: jest.fn() } },
    { provide: ChannelAccessService, useValue: {} },
  ],
  exports: [PrismaService, StorageService, RealtimeGateway, ChannelAccessService],
})
class FakeGlobalsModule {}

describe('ContractsModule (compilação Nest)', () => {
  it('resolve controllers e services', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeGlobalsModule, ContractsModule] })
      .overrideProvider(ResendClient)
      .useValue({ sendTransactional: jest.fn() })
      .compile();

    expect(moduleRef.get(ContractsController)).toBeInstanceOf(ContractsController);
    expect(moduleRef.get(ContractsImportController)).toBeInstanceOf(ContractsImportController);
    expect(moduleRef.get(ContractsService)).toBeInstanceOf(ContractsService);
    expect(moduleRef.get(ContractFilesService)).toBeInstanceOf(ContractFilesService);
    expect(moduleRef.get(ContractPdfService)).toBeInstanceOf(ContractPdfService);
    expect(moduleRef.get(PublicContractsController)).toBeInstanceOf(PublicContractsController);
    expect(moduleRef.get(ContractAcceptanceService)).toBeInstanceOf(ContractAcceptanceService);
    expect(moduleRef.get(ContractNotifierService)).toBeInstanceOf(ContractNotifierService);
    await moduleRef.close();
  });
});
