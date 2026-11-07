import { ConversationStatus, OrgRole } from '@prisma/client';
import {
  isAiInCharge,
  isWaitingForHuman,
  parseResponseSlaMinutes,
  pickBreachRecipients,
  planStages,
  resolveHours,
  stageJobId,
  toHoursConfig,
} from './response-sla.rules';
import type { BusinessHoursConfig } from '../routing/availability/business-hours.util';

const TZ = 'America/Sao_Paulo';
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const WEEKDAYS: BusinessHoursConfig = {
  monday: { enabled: true, windows: [['09:00', '18:00']] },
  tuesday: { enabled: true, windows: [['09:00', '18:00']] },
};

describe('parseResponseSlaMinutes', () => {
  it('lê número >= 1 do settings', () => {
    expect(parseResponseSlaMinutes({ responseSlaMinutes: 15 })).toBe(15);
  });

  it('arredonda para baixo valor fracionado', () => {
    expect(parseResponseSlaMinutes({ responseSlaMinutes: 15.9 })).toBe(15);
  });

  it.each([
    [{}],
    [null],
    [undefined],
    [[]],
    [{ responseSlaMinutes: 0 }],
    [{ responseSlaMinutes: -5 }],
    [{ responseSlaMinutes: '15' }],
    [{ responseSlaMinutes: Number.NaN }],
    [{ responseSlaMinutes: Number.POSITIVE_INFINITY }],
  ])('desligado quando ausente ou inválido (%j)', (settings) => {
    expect(parseResponseSlaMinutes(settings)).toBeNull();
  });
});

describe('toHoursConfig / resolveHours', () => {
  it('aceita só objeto', () => {
    expect(toHoursConfig(WEEKDAYS)).toEqual(WEEKDAYS);
    expect(toHoursConfig(null)).toBeNull();
    expect(toHoursConfig([])).toBeNull();
    expect(toHoursConfig('x')).toBeNull();
  });

  it('usa o horário do atendente quando existe', () => {
    const agent = { monday: { enabled: true } };
    expect(resolveHours(agent, WEEKDAYS)).toEqual(agent);
  });

  it('cai no horário da org quando atendente não tem horário', () => {
    expect(resolveHours(null, WEEKDAYS)).toEqual(WEEKDAYS);
  });

  it('sem nenhum horário = 24/7 (null)', () => {
    expect(resolveHours(null, null)).toBeNull();
  });
});

describe('isWaitingForHuman', () => {
  const base = {
    awaitingHumanReply: true,
    status: ConversationStatus.OPEN,
    deletedAt: null,
    isArchived: false,
  };

  it('espera quando o flag está ligado e a conversa está viva', () => {
    expect(isWaitingForHuman(base)).toBe(true);
  });

  it.each([
    [{ awaitingHumanReply: false }],
    [{ status: ConversationStatus.CLOSED }],
    [{ deletedAt: new Date() }],
    [{ isArchived: true }],
  ])('não espera quando %j', (patch) => {
    expect(isWaitingForHuman({ ...base, ...patch })).toBe(false);
  });
});

describe('isAiInCharge', () => {
  it('IA vai responder e não é plantão → IA no comando', () => {
    expect(isAiInCharge({ aiUntilHandoff: false }, { handle: true })).toBe(true);
  });

  it('plantão do vendedor não tira a responsabilidade dele', () => {
    expect(
      isAiInCharge({ aiUntilHandoff: false }, { handle: true, onCall: { any: 1 } }),
    ).toBe(false);
  });

  it('IA não vai responder → humano', () => {
    expect(isAiInCharge({ aiUntilHandoff: false }, { handle: false })).toBe(false);
  });

  it('lead do site com a Aline até o handoff → IA no comando', () => {
    expect(isAiInCharge({ aiUntilHandoff: true }, { handle: false })).toBe(true);
  });
});

describe('planStages', () => {
  it('aviso na metade e estouro no prazo, em minutos úteis', () => {
    const plan = planStages(WEEKDAYS, TZ, sp('2026-11-09T17:55:00'), 15);
    expect(plan.warnAt).toEqual(sp('2026-11-10T09:02:30'));
    expect(plan.dueAt).toEqual(sp('2026-11-10T09:10:00'));
  });

  it('agenda sem janelas não tem prazo', () => {
    const plan = planStages({ monday: { enabled: false } }, TZ, sp('2026-11-09T10:00:00'), 15);
    expect(plan).toEqual({ warnAt: null, dueAt: null });
  });
});

describe('stageJobId', () => {
  it('é determinístico por conversa, início da espera, etapa e alvo', () => {
    const since = new Date('2026-11-09T13:00:00Z');
    const at = new Date('2026-11-09T13:15:00Z');
    expect(stageJobId('c1', since, 'breach', at)).toBe(
      `rsla-c1-${since.getTime()}-breach-${at.getTime()}`,
    );
    expect(stageJobId('c1', since, 'breach', at)).toBe(stageJobId('c1', since, 'breach', at));
  });
});

describe('pickBreachRecipients', () => {
  const online = [
    { userId: 'owner', role: OrgRole.AGENT },
    { userId: 'adm', role: OrgRole.ADMIN },
    { userId: 'boss', role: OrgRole.OWNER },
    { userId: 'peer', role: OrgRole.AGENT },
  ];

  it('com dono: dono + ADM/Owner online', () => {
    expect(pickBreachRecipients('owner', online)).toEqual(['owner', 'adm', 'boss']);
  });

  it('dono offline ainda recebe', () => {
    const others = online.filter((m) => m.userId !== 'owner');
    expect(pickBreachRecipients('owner', others)).toEqual(['owner', 'adm', 'boss']);
  });

  it('dono que é ADM não recebe em dobro', () => {
    expect(pickBreachRecipients('adm', online)).toEqual(['adm', 'boss']);
  });

  it('sem dono: todos os online', () => {
    expect(pickBreachRecipients(null, online)).toEqual(['owner', 'adm', 'boss', 'peer']);
  });
});
