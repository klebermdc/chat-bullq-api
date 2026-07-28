import { ContextEnrichmentService } from './context-enrichment.service';
import { PrismaService } from '../../../../database/prisma.service';
import { LongTermMemoryService } from './long-term.service';

describe('ContextEnrichmentService — horário', () => {
  let service: ContextEnrichmentService;
  let prisma: {
    contact: { findUnique: jest.Mock };
    conversation: { findUnique: jest.Mock };
    message: { findMany: jest.Mock };
  };
  let memory: { findOne: jest.Mock };

  const buildOrg = () => ({
    aiBusinessHours: {
      monday: { enabled: true, windows: [['09:00', '18:00']] },
    },
    aiTimezone: 'America/Sao_Paulo',
  });

  beforeEach(() => {
    prisma = {
      contact: { findUnique: jest.fn().mockResolvedValue(null) },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          channel: { type: 'WHATSAPP_ZAPPFY', name: 'Aline' },
          organization: buildOrg(),
        }),
      },
      message: { findMany: jest.fn().mockResolvedValue([]) },
    };
    memory = { findOne: jest.fn().mockResolvedValue(null) };

    service = new ContextEnrichmentService(
      prisma as unknown as PrismaService,
      memory as unknown as LongTermMemoryService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('fora do horário: businessHours=false, hoursSummary e nextOpenLabel preenchidos', async () => {
    // domingo 09h BRT (agenda só seg) → fechado
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T12:00:00.000Z'));

    const ctx = await service.enrich({
      agentId: 'a',
      conversationId: 'c1',
      contactId: 'ct',
    });

    expect(ctx.time.businessHours).toBe(false);
    expect(ctx.time.timezone).toBe('America/Sao_Paulo');
    expect(ctx.time.hoursSummary).toContain('seg');
    expect(ctx.time.nextOpenLabel).toBeTruthy();
    // próximo retorno é segunda 09h → "amanhã às 09h"
    expect(ctx.time.nextOpenLabel).toContain('09h');
  });

  it('dentro do horário: businessHours=true, nextOpenLabel null', async () => {
    // segunda 12h BRT → aberto
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T15:00:00.000Z'));

    const ctx = await service.enrich({
      agentId: 'a',
      conversationId: 'c1',
      contactId: 'ct',
    });

    expect(ctx.time.businessHours).toBe(true);
    expect(ctx.time.nextOpenLabel).toBeNull();
    expect(ctx.time.hoursSummary).toContain('seg');
  });

  it('sem agenda (org 24/7): businessHours=true, hoursSummary e nextOpenLabel null', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      channel: { type: 'WHATSAPP_ZAPPFY', name: 'Aline' },
      organization: { aiBusinessHours: null, aiTimezone: 'America/Sao_Paulo' },
    });
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T12:00:00.000Z'));

    const ctx = await service.enrich({
      agentId: 'a',
      conversationId: 'c1',
      contactId: 'ct',
    });

    expect(ctx.time.businessHours).toBe(true);
    expect(ctx.time.hoursSummary).toBeNull();
    expect(ctx.time.nextOpenLabel).toBeNull();
  });
});
