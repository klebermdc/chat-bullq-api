import { OrgRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY, IS_PUBLIC_KEY, FEATURE_KEY } from '../decorators';

/** Contexto mínimo: getHandler/getClass devolvem tokens distintos e estáveis
 * ('handler'/'class') — o fake Reflector abaixo usa esses tokens pra saber
 * de qual camada de metadata puxar cada chave. */
function ctx(userRole?: OrgRole): any {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({
      getRequest: () => ({ organization: userRole ? { userRole } : undefined }),
    }),
  };
}

type MetaLayer = Record<string, unknown>;

/**
 * Reflector fake que modela a precedência REAL do NestJS `getAllAndOverride`:
 * resolve pelo handler primeiro e só cai pro class-level quando o handler não
 * define aquela chave — ou seja, handler SUBSTITUI class, não faz AND.
 *
 * O fake anterior (`getAllAndOverride: (key) => meta[key]`) ignorava o array
 * `[handler, class]` inteiro e lia de um mapa achatado único — testava um
 * comportamento de precedência que nunca existiu no guard real.
 *
 * `layers.handler`/`layers.class` ficam vazios por padrão: testes que só
 * querem "essa chave existe, não importa em qual nível" usam `handler`.
 */
function reflectorWith(layers: { handler?: MetaLayer; class?: MetaLayer }): Reflector {
  const byTarget: Record<string, MetaLayer> = {
    handler: layers.handler ?? {},
    class: layers.class ?? {},
  };
  return {
    getAllAndOverride: (key: string, targets: unknown[]) => {
      for (const target of targets) {
        const layer = byTarget[target as string];
        if (layer && key in layer) return layer[key];
      }
      return undefined;
    },
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('libera rota pública sem olhar role', () => {
    const guard = new RolesGuard(reflectorWith({ handler: { [IS_PUBLIC_KEY]: true } }));
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('sem metadata nenhum, libera (comportamento atual preservado)', () => {
    const guard = new RolesGuard(reflectorWith({}));
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(true);
  });

  it('@Roles continua funcionando: AGENT barrado em rota OWNER/ADMIN', () => {
    const guard = new RolesGuard(
      reflectorWith({ handler: { [ROLES_KEY]: [OrgRole.OWNER, OrgRole.ADMIN] } }),
    );
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
    expect(guard.canActivate(ctx(OrgRole.ADMIN))).toBe(true);
  });

  it('@Feature nega AGENT em settings.view', () => {
    const guard = new RolesGuard(reflectorWith({ handler: { [FEATURE_KEY]: 'settings.view' } }));
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
  });

  it('@Feature libera AGENT em inbox.view', () => {
    const guard = new RolesGuard(reflectorWith({ handler: { [FEATURE_KEY]: 'inbox.view' } }));
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(true);
  });

  it('@Feature com role ausente nega (fail-closed)', () => {
    const guard = new RolesGuard(reflectorWith({ handler: { [FEATURE_KEY]: 'inbox.view' } }));
    expect(guard.canActivate(ctx(undefined))).toBe(false);
  });

  it('@Feature desconhecida nega até para OWNER (fail-closed)', () => {
    const guard = new RolesGuard(reflectorWith({ handler: { [FEATURE_KEY]: 'nao.existe' } }));
    expect(guard.canActivate(ctx(OrgRole.OWNER))).toBe(false);
  });

  it('@Roles e @Feature juntos: precisa passar nos dois', () => {
    const guard = new RolesGuard(
      reflectorWith({
        handler: {
          [ROLES_KEY]: [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.AGENT],
          [FEATURE_KEY]: 'settings.view',
        },
      }),
    );
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
  });

  // --- Precedência handler vs. controller ---------------------------------
  //
  // getAllAndOverride resolve o handler primeiro; se o handler define a
  // chave, o class-level nem é consultado. Isso NÃO é um AND — é uma
  // SUBSTITUIÇÃO. Hoje nenhum controller mistura @Feature de handler com
  // @Feature de classe (é um ou outro), mas é um footgun latente: adicionar
  // um @Feature permissivo num handler de um controller restrito por classe
  // afrouxa o acesso daquela rota silenciosamente, sem nenhum guard/teste
  // pra pegar.
  it('handler-level @Feature SUBSTITUI o do controller (não é AND) — cuidado ao afrouxar', () => {
    // Controller restrito a staff (ex.: settings.view), mas UM handler nele
    // ganha @Feature('inbox.view') — liberado pra ALL. Se fosse AND, AGENT
    // continuaria barrado pelo class-level; não é AND, então AGENT passa.
    const guard = new RolesGuard(
      reflectorWith({
        handler: { [FEATURE_KEY]: 'inbox.view' },
        class: { [FEATURE_KEY]: 'settings.view' },
      }),
    );
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(true);
  });

  it('sem @Feature no handler, cai pro class-level (fallback documentado)', () => {
    const guard = new RolesGuard(
      reflectorWith({
        class: { [FEATURE_KEY]: 'settings.view' },
      }),
    );
    expect(guard.canActivate(ctx(OrgRole.AGENT))).toBe(false);
    expect(guard.canActivate(ctx(OrgRole.ADMIN))).toBe(true);
  });
});
