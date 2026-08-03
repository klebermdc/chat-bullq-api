import { EmailMessageStatus } from '@prisma/client';
import { CampaignStatsService } from './campaign-stats.service';

function makeFakePrisma() {
  return {
    emailMessage: {
      groupBy: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('CampaignStatsService', () => {
  describe('forCampaign', () => {
    it('mapeia o resultado do groupBy para cada status e zera o que não aparece no agrupamento', async () => {
      const prisma = makeFakePrisma();
      // Prisma só devolve linhas para status com pelo menos 1 registro —
      // aqui faltam DELIVERED, COMPLAINED e FAILED de propósito.
      prisma.emailMessage.groupBy.mockResolvedValue([
        { status: EmailMessageStatus.PENDING, _count: { _all: 3 } },
        { status: EmailMessageStatus.SENT, _count: { _all: 5 } },
        { status: EmailMessageStatus.BOUNCED, _count: { _all: 2 } },
      ]);
      prisma.emailMessage.count
        .mockResolvedValueOnce(4) // opened
        .mockResolvedValueOnce(1) // clicked
        .mockResolvedValueOnce(10); // total

      const service = new CampaignStatsService(prisma as any);
      const stats = await service.forCampaign('camp_1', 'org_1');

      expect(stats).toEqual({
        total: 10,
        pending: 3,
        sent: 5,
        delivered: 0,
        bounced: 2,
        complained: 0,
        failed: 0,
        opened: 4,
        clicked: 1,
      });
      expect(prisma.emailMessage.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { campaignId: 'camp_1', organizationId: 'org_1' },
        _count: { _all: true },
      });
    });

    it('conta destinatários distintos com abertura/clique, não o total de eventos', async () => {
      const prisma = makeFakePrisma();
      prisma.emailMessage.groupBy.mockResolvedValue([]);
      // 2 destinatários abriram (mesmo que tenham aberto várias vezes cada),
      // 1 destinatário clicou.
      prisma.emailMessage.count
        .mockResolvedValueOnce(2) // opened
        .mockResolvedValueOnce(1) // clicked
        .mockResolvedValueOnce(0); // total

      const service = new CampaignStatsService(prisma as any);
      const stats = await service.forCampaign('camp_1', 'org_1');

      expect(stats.opened).toBe(2);
      expect(stats.clicked).toBe(1);
      expect(prisma.emailMessage.count).toHaveBeenNthCalledWith(1, {
        where: { campaignId: 'camp_1', organizationId: 'org_1', openCount: { gt: 0 } },
      });
      expect(prisma.emailMessage.count).toHaveBeenNthCalledWith(2, {
        where: { campaignId: 'camp_1', organizationId: 'org_1', clickCount: { gt: 0 } },
      });
    });

    it('todos os status ausentes viram 0, não undefined', async () => {
      const prisma = makeFakePrisma();
      prisma.emailMessage.groupBy.mockResolvedValue([]);
      prisma.emailMessage.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const service = new CampaignStatsService(prisma as any);
      const stats = await service.forCampaign('camp_1', 'org_1');

      expect(stats.pending).toBe(0);
      expect(stats.sent).toBe(0);
      expect(stats.delivered).toBe(0);
      expect(stats.bounced).toBe(0);
      expect(stats.complained).toBe(0);
      expect(stats.failed).toBe(0);
      for (const value of Object.values(stats)) {
        expect(value).not.toBeUndefined();
      }
    });
  });

  describe('failures', () => {
    it('filtra por FAILED e BOUNCED e devolve o motivo real do provedor', async () => {
      const prisma = makeFakePrisma();
      const rows = [
        { to: 'a@example.com', status: EmailMessageStatus.FAILED, failedReason: 'invalid domain' },
        { to: 'b@example.com', status: EmailMessageStatus.BOUNCED, failedReason: 'mailbox full' },
      ];
      prisma.emailMessage.findMany.mockResolvedValue(rows);

      const service = new CampaignStatsService(prisma as any);
      const result = await service.failures('camp_1', 'org_1');

      expect(result).toBe(rows);
      expect(prisma.emailMessage.findMany).toHaveBeenCalledWith({
        where: {
          campaignId: 'camp_1',
          organizationId: 'org_1',
          status: { in: [EmailMessageStatus.FAILED, EmailMessageStatus.BOUNCED] },
        },
        select: { to: true, status: true, failedReason: true },
        take: 100,
      });
    });
  });
});
