import { OnCallService } from './on-call.service';

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
  overrides: { membership?: unknown; now?: Date } = {},
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
      findUnique: jest.fn().mockResolvedValue({ aiTimezone: 'America/Sao_Paulo' }),
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
