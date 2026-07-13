import { Test } from '@nestjs/testing';
import { OrgRole } from '@prisma/client';
import { CrmReportsService } from './crm-reports.service';
import { PrismaService } from '../../database/prisma.service';

async function build(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [CrmReportsService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(CrmReportsService);
}

describe('CrmReportsService.buildLeadsWhere', () => {
  it('AGENT restringe a leads com conversa atribuída a ele', async () => {
    const service = await build({});
    const w: any = service.buildLeadsWhere({
      orgId: 'o1',
      role: OrgRole.AGENT,
      userId: 'u9',
    } as any);
    expect(w.organizationId).toBe('o1');
    expect(w.deletedAt).toBeNull();
    expect(w.conversations).toEqual({ some: { assignedToId: 'u9' } });
  });

  it('combina canal + temperatura + atendente numa mesma conversa', async () => {
    const service = await build({});
    const w: any = service.buildLeadsWhere({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
      channelId: 'c1',
      temperatureMin: 3,
      assignedToId: 'u2',
    } as any);
    expect(w.conversations).toEqual({
      some: { channelId: 'c1', temperature: { gte: 3 }, assignedToId: 'u2' },
    });
  });

  it('tagId, hasProposal e hasDeal viram filtros de relação', async () => {
    const service = await build({});
    const w: any = service.buildLeadsWhere({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
      tagId: 't1',
      hasProposal: true,
      hasDeal: false,
    } as any);
    expect(w.tags).toEqual({ some: { tagId: 't1' } });
    expect(w.proposals).toEqual({ some: {} });
    expect(w.cards).toEqual({ none: {} });
  });
});

describe('CrmReportsService.getLeadsReport (metrics)', () => {
  it('computa contagem, % com proposta/deal e breakdown por tag', async () => {
    const prisma: any = {
      contact: {
        count: jest
          .fn()
          .mockResolvedValueOnce(10) // total
          .mockResolvedValueOnce(4) // withProposal
          .mockResolvedValueOnce(6), // withDeal
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'k1',
            name: 'Ana',
            phone: '551199',
            createdAt: new Date('2026-07-05T00:00:00.000Z'),
            tags: [{ tag: { name: 'Instagram Orgânico' } }],
            _count: { proposals: 1, cards: 0 },
            conversations: [
              {
                assignedTo: { name: 'Pedro' },
                channel: { name: 'WhatsApp' },
                temperature: 3,
              },
            ],
          },
        ]),
      },
      contactTag: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ tagId: 't1', _count: { _all: 5 } }]),
      },
      tag: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 't1', name: 'Instagram Orgânico' }]),
      },
    };
    const service = await build(prisma);
    const r = await service.getLeadsReport({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
    } as any);
    expect(r.metrics.count).toBe(10);
    expect(r.metrics.withProposal).toEqual({ count: 4, pct: 0.4 });
    expect(r.metrics.withDeal).toEqual({ count: 6, pct: 0.6 });
    expect(r.metrics.byTag).toEqual([{ name: 'Instagram Orgânico', count: 5 }]);
    expect(r.rows[0]).toMatchObject({
      name: 'Ana',
      channelName: 'WhatsApp',
      assignedToName: 'Pedro',
      tags: ['Instagram Orgânico'],
      hasProposal: true,
      hasDeal: false,
      temperature: 3,
    });
  });
});
