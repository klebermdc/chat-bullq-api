import { ON_CALL_TOOLS, OnCallService } from './on-call.service';

// Seg-sex 9h-18h (horário de São Paulo, UTC-3).
const HOURS = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
  wednesday: { enabled: true, windows: [['09:00', '18:00']] },
  thursday: { enabled: true, windows: [['09:00', '18:00']] },
  friday: { enabled: true, windows: [['09:00', '18:00']] },
  saturday: { enabled: false, windows: [] },
  sunday: { enabled: false, windows: [] },
};

// Terça 22/09/2026 20:00 em São Paulo = 23:00 UTC (fora do horário).
const TUESDAY_20H = new Date('2026-09-22T23:00:00Z');
// Terça 22/09/2026 10:00 em São Paulo (dentro do horário).
const TUESDAY_10H = new Date('2026-09-22T13:00:00Z');
// Fechou terça 18:00 em São Paulo.
const TUESDAY_18H = new Date('2026-09-22T21:00:00Z');

const CONVERSATION = {
  id: 'conv-1',
  organizationId: 'org-1',
  assignedToId: 'user-pedro',
  lastHumanReplyAt: null as Date | null,
};

function make(
  overrides: { membership?: unknown; now?: Date; org?: Record<string, unknown> } = {},
) {
  const prisma = {
    userOrganization: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.membership === undefined
          ? {
              workingHours: HOURS,
              offHoursNoticeEnabled: true,
              user: { name: 'Pedro Henrique', isActive: true },
            }
          : overrides.membership,
      ),
    },
    organization: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ aiTimezone: 'America/Sao_Paulo', ...overrides.org }),
    },
  } as any;
  const service = new OnCallService(prisma);
  (service as any).clock = () => overrides.now ?? TUESDAY_20H;
  return { service, prisma };
}

describe('OnCallService.evaluate', () => {
  it('ativa o plantão quando o vendedor está fora do horário', async () => {
    const { service } = make();

    const result = await service.evaluate(CONVERSATION);

    expect(result).toEqual({ sellerName: 'Pedro', returnAt: expect.stringContaining('9') });
  });

  it('não ativa dentro do horário do vendedor', async () => {
    const { service } = make({ now: TUESDAY_10H });

    expect(await service.evaluate(CONVERSATION)).toBeNull();
  });

  it('não ativa em conversa sem vendedor', async () => {
    const { service, prisma } = make();

    expect(await service.evaluate({ ...CONVERSATION, assignedToId: null })).toBeNull();
    expect(prisma.userOrganization.findUnique).not.toHaveBeenCalled();
  });

  it('não ativa quando o plantão do vendedor está desligado', async () => {
    const { service } = make({
      membership: { workingHours: HOURS, offHoursNoticeEnabled: false, user: { name: 'Pedro', isActive: true } },
    });

    expect(await service.evaluate(CONVERSATION)).toBeNull();
  });

  it('não ativa quando o vendedor não tem horário cadastrado', async () => {
    const { service } = make({
      membership: { workingHours: null, offHoursNoticeEnabled: true, user: { name: 'Pedro', isActive: true } },
    });

    expect(await service.evaluate(CONVERSATION)).toBeNull();
  });

  it('sai quando um humano respondeu depois que o vendedor saiu', async () => {
    const { service } = make();
    const repliedAfterClose = new Date(TUESDAY_18H.getTime() + 30 * 60_000);

    expect(
      await service.evaluate({ ...CONVERSATION, lastHumanReplyAt: repliedAfterClose }),
    ).toBeNull();
  });

  it('continua de plantão se a última resposta humana foi antes de o vendedor sair', async () => {
    const { service } = make();
    const repliedDuringHours = new Date(TUESDAY_18H.getTime() - 30 * 60_000);

    const result = await service.evaluate({ ...CONVERSATION, lastHumanReplyAt: repliedDuringHours });

    expect(result?.sellerName).toBe('Pedro');
  });
});

describe('OnCallService.evaluate no feriado', () => {
  // Feriado na terça 22/09 inteira: começou 8h, acaba 23/09 00:00 em São Paulo.
  const HOLIDAY = {
    aiHolidayStartedAt: new Date('2026-09-22T11:00:00Z'),
    aiHolidayUntil: new Date('2026-09-23T03:00:00Z'),
    aiBusinessHours: HOURS,
  };

  it('cobre o vendedor mesmo dentro do horário dele e com o plantão desligado', async () => {
    const { service } = make({
      now: TUESDAY_10H,
      org: HOLIDAY,
      membership: { workingHours: HOURS, offHoursNoticeEnabled: false, user: { name: 'Pedro Henrique' } },
    });

    const result = await service.evaluate(CONVERSATION);

    expect(result).toEqual({ sellerName: 'Pedro', returnAt: 'amanhã às 09h', isHoliday: true });
  });

  it('usa o horário da agência quando o vendedor não tem grade', async () => {
    const { service } = make({
      now: TUESDAY_10H,
      org: HOLIDAY,
      membership: { workingHours: null, offHoursNoticeEnabled: false, user: { name: 'Pedro' } },
    });

    expect((await service.evaluate(CONVERSATION))?.returnAt).toBe('amanhã às 09h');
  });

  it('sai quando um humano respondeu depois que o feriado começou', async () => {
    const { service } = make({ now: TUESDAY_10H, org: HOLIDAY });
    const repliedDuringHoliday = new Date('2026-09-22T12:00:00Z');

    expect(
      await service.evaluate({ ...CONVERSATION, lastHumanReplyAt: repliedDuringHoliday }),
    ).toBeNull();
  });

  it('feriado vencido volta à regra normal', async () => {
    const { service } = make({
      now: TUESDAY_10H,
      org: { ...HOLIDAY, aiHolidayUntil: new Date('2026-09-22T12:00:00Z') },
    });

    expect(await service.evaluate(CONVERSATION)).toBeNull();
  });
});

describe('ON_CALL_TOOLS', () => {
  it('no plantão a Aline só responde, deixa recado, abre chamado e usa o canal de urgência: sem consultar produto ou pedido', () => {
    expect([...ON_CALL_TOOLS].sort()).toEqual([
      'leaveNoteForSeller',
      'openSupportTicket',
      'replyToConversation',
      'sendEmergencyContact',
    ]);
  });
});
