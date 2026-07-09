import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConversationSource } from '@prisma/client';
import { LeadIntakeService } from './lead-intake.service';

describe('LeadIntakeService', () => {
  let prisma: any;
  let service: LeadIntakeService;

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn() },
      leadIntake: { create: jest.fn().mockResolvedValue({ id: 'li1' }) },
    };
    service = new LeadIntakeService(prisma);
  });

  it('rejeita secret inválido', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: 'right' });
    await expect(service.ingest('org1', 'wrong', { phone: '11982015967' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita quando a org não tem secret configurado', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: null });
    await expect(service.ingest('org1', 'x', { phone: '11982015967' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita telefone inválido', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: 's' });
    await expect(service.ingest('org1', 's', { phone: '123' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria LeadIntake SITE_FORM com telefone normalizado e detalhe', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: 's' });
    const out = await service.ingest('org1', 's', {
      phone: '+55 (11) 98201-5967', name: 'Fulano', page: '/orcamento', utmSource: 'google',
    });
    expect(out).toEqual({ id: 'li1' });
    expect(prisma.leadIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org1',
        phoneNormalized: '5511982015967',
        name: 'Fulano',
        source: ConversationSource.SITE_FORM,
        sourceDetail: expect.objectContaining({ page: '/orcamento', utmSource: 'google' }),
      }),
      select: { id: true },
    });
  });
});
