import { OrgRole } from '@prisma/client';
import { ContractCalendarService } from './contract-calendar.service';

const WINDOW = { from: '2026-11-01', to: '2026-12-31', today: '2026-11-01' };
const ROW = {
  id: 'c1',
  fullName: 'Ana Souza',
  phone: '+55 11 90000-0000',
  guideName: 'Kleber',
  disneyGuest: false,
  purchased: true,
  parkDates: [{ parkId: 'epcot', date: '2026-12-10' }],
  requestedDates: '',
  createdAt: new Date('2026-10-01T12:00:00Z'),
};

function make(rows: unknown[] = [ROW]) {
  const repo = { findForCalendar: jest.fn().mockResolvedValue(rows) } as any;
  return { service: new ContractCalendarService(repo), repo };
}

describe('ContractCalendarService', () => {
  const prevUrl = process.env.APP_PUBLIC_URL;
  afterEach(() => {
    if (prevUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = prevUrl;
  });

  it('AGENT busca só os contratos que criou', async () => {
    const { service, repo } = make([]);
    await service.events('org1', { userId: 'u1', role: OrgRole.AGENT }, WINDOW);
    expect(repo.findForCalendar).toHaveBeenCalledWith('org1', { createdById: 'u1' }, '2026-11-01', undefined);
  });

  it('staff vê a org toda e repassa o guia', async () => {
    const { service, repo } = make([]);
    await service.events('org1', { userId: 'u1', role: OrgRole.OWNER }, WINDOW, 'Kleber');
    expect(repo.findForCalendar).toHaveBeenCalledWith('org1', {}, '2026-11-01', 'Kleber');
  });

  it('devolve fuso, janela e eventos, com link do painel sem barra final', async () => {
    process.env.APP_PUBLIC_URL = 'https://painel.teste/';
    const { service } = make();
    const out = await service.events('org1', { userId: 'u1', role: OrgRole.ADMIN }, WINDOW);
    expect(out).toMatchObject({
      timezone: 'America/New_York',
      from: '2026-11-01',
      to: '2026-12-31',
      complete: true,
      count: 1,
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].description).toContain('Contrato: https://painel.teste/contratos/c1\n');
  });

  it('com filtro de guia a lista é parcial: complete false', async () => {
    const { service } = make();
    const out = await service.events('org1', { userId: 'u1', role: OrgRole.ADMIN }, WINDOW, 'Kleber');
    expect(out.complete).toBe(false);
    expect(out.count).toBe(out.events.length);
  });

  it('sem APP_PUBLIC_URL usa só o id do contrato', async () => {
    delete process.env.APP_PUBLIC_URL;
    const { service } = make();
    const out = await service.events('org1', { userId: 'u1', role: OrgRole.ADMIN }, WINDOW);
    expect(out.events[0].description).toContain('Contrato: c1\n');
  });
});
