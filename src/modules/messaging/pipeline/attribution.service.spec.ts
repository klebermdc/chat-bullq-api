import { ConversationSource } from '@prisma/client';
import { AttributionService } from './attribution.service';

describe('AttributionService', () => {
  const service = new AttributionService();

  function txWith(leadIntake: any) {
    return {
      leadIntake: { findFirst: jest.fn().mockResolvedValue(leadIntake) },
    } as any;
  }

  it('prioriza CTWA quando há referral, sem consultar LeadIntake', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511999999999',
      referral: { sourceType: 'ad', sourceId: '120', ctwaClid: 'clid-abc' },
    });
    expect(out.source).toBe(ConversationSource.CTWA);
    expect(out.sourceDetail).toMatchObject({ sourceType: 'ad', adId: '120', ctwaClid: 'clid-abc' });
    expect(out.matchedLeadIntakeId).toBeNull();
    expect(tx.leadIntake.findFirst).not.toHaveBeenCalled();
  });

  it('casa SITE_FORM por sufixo de telefone quando não há referral', async () => {
    const tx = txWith({
      id: 'li1',
      source: ConversationSource.SITE_FORM,
      sourceDetail: { page: '/orcamento', utmSource: 'google' },
    });
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511982015967',
    });
    expect(out.source).toBe(ConversationSource.SITE_FORM);
    expect(out.sourceDetail).toMatchObject({ page: '/orcamento', utmSource: 'google' });
    expect(out.matchedLeadIntakeId).toBe('li1');
    expect(tx.leadIntake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org1',
          consumedAt: null,
          phoneNormalized: { endsWith: '5511982015967'.slice(-10) },
          createdAt: { gte: expect.any(Date) },
        }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('referral sem ctwaClid nem sourceId NÃO é CTWA — cai no caminho do telefone', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511982015967',
      referral: { sourceType: 'ad' },
    });
    expect(out.source).toBe(ConversationSource.ORGANIC);
    expect(out.matchedLeadIntakeId).toBeNull();
    expect(tx.leadIntake.findFirst).toHaveBeenCalled();
  });

  it('telefone inválido/curto degrada para ORGANIC sem consultar LeadIntake', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '123',
    });
    expect(out.source).toBe(ConversationSource.ORGANIC);
    expect(out.matchedLeadIntakeId).toBeNull();
    expect(tx.leadIntake.findFirst).not.toHaveBeenCalled();
  });

  it('cai para ORGANIC quando não há referral nem LeadIntake', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511982015967',
    });
    expect(out.source).toBe(ConversationSource.ORGANIC);
    expect(out.matchedLeadIntakeId).toBeNull();
  });

  it('é ORGANIC quando não há telefone para casar', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, { organizationId: 'org1' });
    expect(out.source).toBe(ConversationSource.ORGANIC);
    expect(tx.leadIntake.findFirst).not.toHaveBeenCalled();
  });
});
