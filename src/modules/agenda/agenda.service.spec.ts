import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { AgendaService } from './agenda.service';

const ADMIN = { userId: 'adm', role: OrgRole.ADMIN };
const AGENT = { userId: 'renata', role: OrgRole.AGENT };
const TZ = 'America/Sao_Paulo';
const sp = (iso: string) => new Date(`${iso}-03:00`);
const NOW = sp('2026-11-13T15:00:00'); // sexta 15h
const HOURS = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((d) => [d, { enabled: true, windows: [['09:00', '18:00']] }]),
);

function make(opts: { existing?: any; busy?: any[]; isMember?: boolean; contactOk?: boolean } = {}) {
  const repo = {
    isMember: jest.fn().mockResolvedValue(opts.isMember ?? true),
    contactInOrg: jest.fn().mockResolvedValue(opts.contactOk ?? true),
    ownerSchedule: jest.fn().mockResolvedValue({ tz: TZ, hours: HOURS }),
    findBusy: jest.fn().mockResolvedValue(opts.busy ?? []),
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(opts.existing ?? null),
    create: jest.fn().mockImplementation(async (d: any) => ({ id: 'a1', ...d })),
    update: jest.fn().mockImplementation(async (_id: string, d: any) => ({ id: 'a1', ...opts.existing, ...d })),
  } as any;
  const reminders = { schedule: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AgendaService(repo, reminders, () => NOW);
  return { svc, repo, reminders };
}

const novo = (extra: Record<string, unknown> = {}) => ({ contactId: 'c1', startsAt: '2026-11-16T10:00:00-03:00', ...extra });

describe('AgendaService.list', () => {
  it('atendente só enxerga a própria agenda, mesmo pedindo a de outro', async () => {
    const { svc, repo } = make();
    await svc.list('org1', AGENT, { from: '2026-11-16', to: '2026-11-20', ownerUserId: 'pedro' });
    expect(repo.list).toHaveBeenCalledWith('org1', expect.objectContaining({ ownerUserId: 'renata' }));
  });

  it('gestão vê de todos ou filtra por vendedor', async () => {
    const { svc, repo } = make();
    await svc.list('org1', ADMIN, { from: '2026-11-16', to: '2026-11-20' });
    expect(repo.list).toHaveBeenCalledWith('org1', expect.objectContaining({ ownerUserId: undefined }));
    await svc.list('org1', ADMIN, { from: '2026-11-16', to: '2026-11-20', ownerUserId: 'pedro' });
    expect(repo.list).toHaveBeenLastCalledWith('org1', expect.objectContaining({ ownerUserId: 'pedro' }));
  });

  it('recusa período invertido ou maior que 62 dias', async () => {
    const { svc } = make();
    await expect(svc.list('org1', ADMIN, { from: '2026-11-20', to: '2026-11-16' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.list('org1', ADMIN, { from: '2026-01-01', to: '2026-12-31' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AgendaService.create', () => {
  it('atendente marca na própria agenda (ignora ownerUserId de outro)', async () => {
    const { svc, repo } = make();
    await svc.create('org1', AGENT, novo({ ownerUserId: 'pedro' }));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org1', ownerUserId: 'renata', createdByUserId: 'renata', source: 'MANUAL' }),
    );
  });

  it('gestão marca para um vendedor da empresa; vendedor de fora dá 403', async () => {
    const { svc, repo } = make();
    await svc.create('org1', ADMIN, novo({ ownerUserId: 'pedro' }));
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'pedro' }));
    const fora = make({ isMember: false });
    await expect(fora.svc.create('org1', ADMIN, novo({ ownerUserId: 'x' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('contato de outra empresa dá 404', async () => {
    const { svc } = make({ contactOk: false });
    await expect(svc.create('org1', AGENT, novo())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa fora do expediente e conflito, com o motivo na resposta', async () => {
    const { svc } = make();
    await expect(svc.create('org1', AGENT, novo({ startsAt: '2026-11-15T10:00:00-03:00' }))).rejects.toMatchObject({
      response: { code: 'FORA_DO_EXPEDIENTE' },
    });
    const ocupado = make({ busy: [{ startsAt: sp('2026-11-16T10:00:00'), durationMin: 30 }] });
    await expect(ocupado.svc.create('org1', AGENT, novo())).rejects.toMatchObject({ response: { code: 'CONFLITO' } });
  });

  it('data inválida dá 400', async () => {
    const { svc } = make();
    await expect(svc.create('org1', AGENT, novo({ startsAt: 'amanhã' }))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AgendaService lembretes', () => {
  it('agenda lembretes ao marcar e ao remarcar', async () => {
    const { svc, reminders } = make({
      existing: { id: 'a1', organizationId: 'org1', ownerUserId: 'renata', startsAt: sp('2026-11-16T10:00:00'), durationMin: 15, status: 'MARCADO' },
    });
    await svc.create('org1', AGENT, novo());
    expect(reminders.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), NOW);
    await svc.reschedule('org1', AGENT, 'a1', { startsAt: '2026-11-16T11:00:00-03:00' });
    expect(reminders.schedule).toHaveBeenCalledTimes(2);
  });
});

describe('AgendaService.reschedule / setStatus', () => {
  const existente = {
    id: 'a1', organizationId: 'org1', ownerUserId: 'renata', startsAt: sp('2026-11-16T10:00:00'), durationMin: 15, status: 'MARCADO',
  };

  it('remarca conferindo de novo as regras, sem conflitar consigo mesmo', async () => {
    const { svc, repo } = make({ existing: existente });
    await svc.reschedule('org1', AGENT, 'a1', { startsAt: '2026-11-16T10:05:00-03:00' });
    expect(repo.findBusy).toHaveBeenCalledWith('org1', 'renata', expect.any(Date), expect.any(Date), 'a1');
    expect(repo.update).toHaveBeenCalledWith('a1', expect.objectContaining({ startsAt: sp('2026-11-16T10:05:00') }));
  });

  it('atendente não mexe na agenda de outro (404 para não vazar)', async () => {
    const { svc } = make({ existing: { ...existente, ownerUserId: 'pedro' } });
    await expect(svc.setStatus('org1', AGENT, 'a1', 'CANCELADO')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não remarca compromisso já cancelado ou feito', async () => {
    const { svc } = make({ existing: { ...existente, status: 'CANCELADO' } });
    await expect(svc.reschedule('org1', AGENT, 'a1', { startsAt: '2026-11-16T11:00:00-03:00' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AgendaService.freeSlots', () => {
  it('devolve horários livres do vendedor com 1h de antecedência', async () => {
    const { svc } = make();
    const slots = await svc.freeSlots('org1', 'renata', { count: 3 });
    expect(slots).toEqual([sp('2026-11-13T16:00:00'), sp('2026-11-13T16:30:00'), sp('2026-11-13T17:00:00')]);
  });
});
