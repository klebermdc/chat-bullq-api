import { OrgRole } from '@prisma/client';
import { actorScope, isStaff } from './contract-actor';

describe('actorScope', () => {
  it('OWNER e ADMIN enxergam todos os contratos da org', () => {
    expect(actorScope({ userId: 'u1', role: OrgRole.OWNER })).toEqual({});
    expect(actorScope({ userId: 'u1', role: OrgRole.ADMIN })).toEqual({});
  });

  it('AGENT só enxerga os contratos que criou', () => {
    expect(actorScope({ userId: 'u1', role: OrgRole.AGENT })).toEqual({ createdById: 'u1' });
  });

  it('papel indefinido fecha no escopo do próprio usuário', () => {
    expect(actorScope({ userId: 'u1', role: undefined })).toEqual({ createdById: 'u1' });
  });

  it('isStaff só para OWNER e ADMIN', () => {
    expect(isStaff({ userId: 'u', role: OrgRole.OWNER })).toBe(true);
    expect(isStaff({ userId: 'u', role: OrgRole.ADMIN })).toBe(true);
    expect(isStaff({ userId: 'u', role: OrgRole.AGENT })).toBe(false);
    expect(isStaff({ userId: 'u', role: undefined })).toBe(false);
  });
});
