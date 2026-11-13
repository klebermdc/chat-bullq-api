import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaRepository } from './agenda.repository';
import { AgendaService } from './agenda.service';

@Module({
  controllers: [AgendaController],
  providers: [AgendaRepository, AgendaService],
  exports: [AgendaService],
})
export class AgendaModule {}
