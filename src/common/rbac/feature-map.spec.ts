import { OrgRole } from '@prisma/client';
import { can, permissionsFor, FEATURE_MAP } from './feature-map';

describe('feature-map', () => {
  it('AGENT atende no inbox', () => {
    expect(can(OrgRole.AGENT, 'inbox.view')).toBe(true);
  });

  it('AGENT não abre Configurações', () => {
    expect(can(OrgRole.AGENT, 'settings.view')).toBe(false);
  });

  it('AGENT não liga/desliga a IA da conversa', () => {
    expect(can(OrgRole.AGENT, 'inbox.ai.toggle')).toBe(false);
  });

  it('AGENT não usa ações em massa', () => {
    expect(can(OrgRole.AGENT, 'inbox.bulk')).toBe(false);
  });

  it('AGENT não exclui arquivo da Biblioteca, mas usa', () => {
    expect(can(OrgRole.AGENT, 'media.delete')).toBe(false);
    expect(can(OrgRole.AGENT, 'media.use')).toBe(true);
  });

  it('ADMIN e OWNER acessam tudo que existe no mapa', () => {
    for (const key of Object.keys(FEATURE_MAP)) {
      expect(can(OrgRole.ADMIN, key)).toBe(true);
      expect(can(OrgRole.OWNER, key)).toBe(true);
    }
  });

  it('feature desconhecida é negada (fail-closed)', () => {
    expect(can(OrgRole.OWNER, 'feature.que.nao.existe')).toBe(false);
  });

  it('role ausente é negado (fail-closed)', () => {
    expect(can(undefined, 'inbox.view')).toBe(false);
  });

  it('permissionsFor(AGENT) traz só o permitido e nada de settings', () => {
    const perms = permissionsFor(OrgRole.AGENT);
    expect(perms).toContain('inbox.view');
    expect(perms).not.toContain('settings.view');
    expect(perms).not.toContain('automations.view');
  });

  it('permissionsFor(role ausente) é lista vazia', () => {
    expect(permissionsFor(undefined)).toEqual([]);
  });
});
