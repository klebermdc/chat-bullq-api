import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * `isMysteryShopper` nunca sai do banco por padrão: contato vai para o
 * vendedor em dezenas de lugares (inbox, ligações, tempo real) e a marca
 * de cliente oculto não pode vazar por nenhum deles. Filtros `where`
 * continuam funcionando; quem precisar ler o campo usa `omit: { isMysteryShopper: false }`.
 */
export const PRISMA_CLIENT_OPTIONS = {
  omit: { contact: { isMysteryShopper: true } },
} as const;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super(PRISMA_CLIENT_OPTIONS);
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
