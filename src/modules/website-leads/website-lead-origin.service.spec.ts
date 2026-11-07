import { NotFoundException } from '@nestjs/common';
import { WebsiteLeadOriginService } from './website-lead-origin.service';

function make(contact: any) {
  const prisma = {
    contact: { findFirst: jest.fn().mockResolvedValue(contact) },
    adDailyStat: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where.adId === '333333') return Promise.resolve({ adName: 'video12', adsetName: 'Conjunto A', campaignName: 'Campanha X' });
        if (where.campaignId === '111111') return Promise.resolve({ campaignName: 'Campanha X' });
        return Promise.resolve(null);
      }),
    },
    leadSubmission: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 's1',
          createdAt: new Date('2026-11-07T12:00:00Z'),
          formKind: 'main',
          followupStatus: 'SENT',
          followupReason: null,
          attribution: { utm_source: 'ig', utm_medium: 'paid', utm_campaign: '111111' },
        },
      ]),
    },
  } as any;
  return { service: new WebsiteLeadOriginService(prisma), prisma };
}

describe('WebsiteLeadOriginService.forContact', () => {
  it('contato de outra org → 404', async () => {
    const { service } = make(null);
    await expect(service.forContact('org-1', 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mostra a origem do site com os nomes de campanha e anúncio da Meta', async () => {
    const { service } = make({
      metadata: { attribution: { utm_source: 'ig', utm_campaign: '111111', utm_content: '333333', page_url: 'https://x/' } },
      ctwaSourceId: null,
      ctwaClidAt: null,
    });
    const view = await service.forContact('org-1', 'c1');
    expect(view.site).toMatchObject({
      utm_source: 'ig',
      campaignName: 'Campanha X',
      adName: 'video12',
      adsetName: 'Conjunto A',
      page_url: 'https://x/',
    });
    expect(view.ctwa).toBeNull();
    expect(view.submissions[0]).toMatchObject({ source: 'ig', medium: 'paid', campaign: '111111', followupStatus: 'SENT' });
  });

  it('lead de anúncio CTWA mostra o anúncio pelo source_id', async () => {
    const { service } = make({ metadata: {}, ctwaSourceId: '333333', ctwaSourceType: 'ad', ctwaClidAt: new Date() });
    const view = await service.forContact('org-1', 'c1');
    expect(view.site).toBeNull();
    expect(view.ctwa).toMatchObject({ sourceId: '333333', adName: 'video12', campaignName: 'Campanha X' });
  });
});
