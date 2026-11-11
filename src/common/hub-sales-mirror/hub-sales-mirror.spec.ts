import { ForbiddenException } from '@nestjs/common';
import { hasHubSalesMirror } from './hub-sales-mirror.rules';
import { HubSalesMirrorAccess } from './hub-sales-mirror.service';
import { HubSalesMirrorGuard } from './hub-sales-mirror.guard';

describe('hasHubSalesMirror', () => {
  it('só libera com a marca explicitamente true', () => {
    expect(hasHubSalesMirror({ hubSalesMirror: true })).toBe(true);
    expect(hasHubSalesMirror({ hubSalesMirror: 'true' })).toBe(false);
    expect(hasHubSalesMirror({})).toBe(false);
    expect(hasHubSalesMirror(null)).toBe(false);
    expect(hasHubSalesMirror([true])).toBe(false);
  });
});

function makeAccess(orgs: Array<{ id: string; settings: unknown }>) {
  const prisma = {
    organization: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(orgs.find((o) => o.id === where.id) ?? null),
      ),
      findMany: jest.fn().mockResolvedValue(orgs.filter((o) => hasHubSalesMirror(o.settings))),
    },
  } as any;
  return { access: new HubSalesMirrorAccess(prisma), prisma };
}

describe('HubSalesMirrorAccess', () => {
  const ORGS = [
    { id: 'ofp', settings: { hubSalesMirror: true } },
    { id: 'outra', settings: {} },
  ];

  it('libera só a org marcada como dona do Hub', async () => {
    const { access } = makeAccess(ORGS);
    await expect(access.isEnabledFor('ofp')).resolves.toBe(true);
    await expect(access.isEnabledFor('outra')).resolves.toBe(false);
    await expect(access.isEnabledFor('nao-existe')).resolves.toBe(false);
  });

  it('lista as orgs donas do Hub filtrando pela marca no settings', async () => {
    const { access, prisma } = makeAccess(ORGS);
    await expect(access.ownerOrgIds()).resolves.toEqual(['ofp']);
    expect(prisma.organization.findMany).toHaveBeenCalledWith({
      where: { settings: { path: ['hubSalesMirror'], equals: true } },
      select: { id: true },
    });
  });
});

describe('HubSalesMirrorGuard', () => {
  const ctxFor = (organization?: { id: string }) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ organization }) }) }) as any;

  it('deixa passar a org dona do Hub', async () => {
    const { access } = makeAccess([{ id: 'ofp', settings: { hubSalesMirror: true } }]);
    await expect(new HubSalesMirrorGuard(access).canActivate(ctxFor({ id: 'ofp' }))).resolves.toBe(true);
  });

  it('bloqueia outra org e requisição sem org', async () => {
    const { access } = makeAccess([{ id: 'outra', settings: {} }]);
    const guard = new HubSalesMirrorGuard(access);
    await expect(guard.canActivate(ctxFor({ id: 'outra' }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
