import { OrgRole } from '@prisma/client';
import { pipelineCardScopeWhere } from './pipeline-scope';

describe('pipelineCardScopeWhere', () => {
  it('OWNER não recebe filtro', () => {
    expect(pipelineCardScopeWhere(OrgRole.OWNER, 'u1')).toEqual({});
  });

  it('ADMIN não recebe filtro', () => {
    expect(pipelineCardScopeWhere(OrgRole.ADMIN, 'u1')).toEqual({});
  });

  it('AGENT recebe OR de conversa dele ou card dele', () => {
    expect(pipelineCardScopeWhere(OrgRole.AGENT, 'u1')).toEqual({
      OR: [{ conversation: { assignedToId: 'u1' } }, { assignedToId: 'u1' }],
    });
  });

  it('role ausente falha fechado (escopa)', () => {
    expect(pipelineCardScopeWhere(undefined, 'u1')).toEqual({
      OR: [{ conversation: { assignedToId: 'u1' } }, { assignedToId: 'u1' }],
    });
  });
});
