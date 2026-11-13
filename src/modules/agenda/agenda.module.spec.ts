import { Test } from '@nestjs/testing';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { PrismaService } from '../../database/prisma.service';
import { AgendaController } from './agenda.controller';
import { AgendaRepository } from './agenda.repository';
import { AgendaService } from './agenda.service';

// Garante que o Nest consegue montar a agenda (o relógio do serviço é opcional).
describe('AgendaModule (injeção)', () => {
  it('monta controller, serviço e repositório', async () => {
    const mod = await Test.createTestingModule({
      controllers: [AgendaController],
      providers: [AgendaRepository, AgendaService, { provide: PrismaService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(OrgGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();
    const svc = mod.get(AgendaService);
    expect(svc).toBeInstanceOf(AgendaService);
    expect(mod.get(AgendaController)).toBeDefined();
  });
});
