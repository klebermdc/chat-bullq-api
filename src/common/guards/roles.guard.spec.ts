import { OrgRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY, IS_PUBLIC_KEY, FEATURE_KEY } from '../decorators';

/** Contexto mínimo: só precisa de getHandler/getClass e do request. */
function ctx(userRole?: OrgRole): any {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({
      getRequest: () => ({ organization: userRole ? { userRole } : undefined }),
    }),
  };
}

/** Reflector que devolve valores fixos por chave de metadata. */
function reflectorWith(meta: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('libera rota pública sem olhar role', () => {
    const guard = new RolesGuard(reflectorWith({ [IS_PUBLIC_KEY]: true }));
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('sem metadata nenhum, libera (comportamento atual preservado)', () => {
    const guard = new RolesGuard(reflectorWith({}));
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(true);
  });

  it('@Roles continua funcionando: AGENT barrado em rota OWNER/ADMIN', () => {
    const guard = new RolesGuard(
      reflectorWith({ [ROLES_KEY]: [OrgRole.OWNER, OrgRole.ADMIN] }),
    );
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
    expect(guard.canActivate(ctx(OrgRole.ADMIN))).toBe(true);
  });

  it('@Feature nega AGENT em settings.view', () => {
    const guard = new RolesGuard(reflectorWith({ [FEATURE_KEY]: 'settings.view' }));
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
  });

  it('@Feature libera AGENT em inbox.view', () => {
    const guard = new RolesGuard(reflectorWith({ [FEATURE_KEY]: 'inbox.view' }));
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(true);
  });

  it('@Feature com role ausente nega (fail-closed)', () => {
    const guard = new RolesGuard(reflectorWith({ [FEATURE_KEY]: 'inbox.view' }));
    expect(guard.canActivate(ctx(undefined))).toBe(false);
  });

  it('@Feature desconhecida nega até para OWNER (fail-closed)', () => {
    const guard = new RolesGuard(reflectorWith({ [FEATURE_KEY]: 'nao.existe' }));
    expect(guard.canActivate(ctx(OrgRole.OWNER))).toBe(false);
  });

  it('@Roles e @Feature juntos: precisa passar nos dois', () => {
    const guard = new RolesGuard(
      reflectorWith({
        [ROLES_KEY]: [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT],
        [FEATURE_KEY]: 'settings.view',
      }),
    );
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
  });
});
