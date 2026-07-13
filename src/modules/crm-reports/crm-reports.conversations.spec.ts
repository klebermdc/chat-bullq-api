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

describe('CrmReportsService.buildConversationsWhere', () => {
  it('AGENT restringe às conversas atribuídas a ele', async () => {
    const service = await build({});
    const w: any = service.buildConversationsWhere({
      orgId: 'o1',
      role: OrgRole.AGENT,
      userId: 'u9',
    } as any);
    expect(w.organizationId).toBe('o1');
    expect(w.deletedAt).toBeNull();
    expect(w.assignedToId).toBe('u9');
  });

  it('aplica status, canal, tag, reaberta e respondida', async () => {
    const service = await build({});
    const w: any = service.buildConversationsWhere({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
      status: 'CLOSED',
      channelId: 'c1',
      tagId: 't1',
      reopened: true,
      answered: false,
    } as any);
    expect(w.status).toBe('CLOSED');
    expect(w.channelId).toBe('c1');
    expect(w.tags).toEqual({ some: { tagId: 't1' } });
    expect(w.reopenedCount).toEqual({ gt: 0 });
    expect(w.firstResponseAt).toBeNull();
  });
});

describe('CrmReportsService.getConversationsReport (metrics)', () => {
  it('computa abertas/finalizadas, reaberturas e tempo médio de 1a resposta', async () => {
    const prisma: any = {
      conversation: {
        count: jest
          .fn()
          .mockResolvedValueOnce(8) // total
          .mockResolvedValueOnce(2) // reopened
          .mockResolvedValueOnce(6), // answeredCount
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { status: 'CLOSED', _count: { _all: 3 } },
            { status: 'OPEN', _count: { _all: 5 } },
          ]) // statusGroups
          .mockResolvedValueOnce([{ channelId: 'c1', _count: { _all: 8 } }]), // channelGroups
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              createdAt: new Date('2026-07-01T10:00:00.000Z'),
              firstResponseAt: new Date('2026-07-01T10:02:00.000Z'), // 120s
            },
            {
              createdAt: new Date('2026-07-01T11:00:00.000Z'),
              firstResponseAt: new Date('2026-07-01T11:04:00.000Z'), // 240s
            },
          ]) // frSample
          .mockResolvedValueOnce([
            {
              id: 'cv1',
              contact: { name: 'Ana', phone: null },
              channel: { name: 'WhatsApp' },
              assignedTo: { name: 'Pedro' },
              status: 'CLOSED',
              firstResponseAt: new Date('2026-07-01T10:02:00.000Z'),
              createdAt: new Date('2026-07-01T10:00:00.000Z'),
              reopenedCount: 1,
              closedAt: new Date('2026-07-01T12:00:00.000Z'),
            },
          ]), // convs
      },
      channel: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'c1', name: 'WhatsApp' }]),
      },
    };
    const service = await build(prisma);
    const r = await service.getConversationsReport({
      orgId: 'o1',
      role: OrgRole.ADMIN,
      userId: 'u1',
    } as any);
    expect(r.metrics.count).toBe(8);
    expect(r.metrics.closed).toBe(3);
    expect(r.metrics.open).toBe(5);
    expect(r.metrics.reopened).toBe(2);
    expect(r.metrics.answeredCount).toBe(6);
    expect(r.metrics.avgFirstResponseSeconds).toBe(180); // (120+240)/2
    expect(r.metrics.byChannel).toEqual([{ name: 'WhatsApp', count: 8 }]);
    expect(r.rows[0]).toMatchObject({
      contactName: 'Ana',
      channelName: 'WhatsApp',
      assignedToName: 'Pedro',
      firstResponseSeconds: 120,
      reopenedCount: 1,
    });
  });
});
