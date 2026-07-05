import { mapMember } from './member.mapper';

describe('mapMember', () => {
  const raw = {
    id: 'mem1', userId: 'u1', organizationId: 'o', role: 'ADMIN', agentStatus: 'ONLINE',
    maxConcurrent: 5, preferences: { theme: 'dark' }, joinedAt: new Date('2026-01-01'),
    user: { id: 'u1', name: 'Ana', email: 'ana@x.com', avatarUrl: 'http://x/a.png', isActive: true },
  };

  it('expõe membership id + userId e omite internos (preferences, maxConcurrent, organizationId)', () => {
    const out = mapMember(raw as any);
    expect(out).toEqual({
      id: 'mem1', userId: 'u1', name: 'Ana', email: 'ana@x.com', avatarUrl: 'http://x/a.png',
      role: 'ADMIN', agentStatus: 'ONLINE', joinedAt: new Date('2026-01-01'),
    });
    expect((out as any).preferences).toBeUndefined();
    expect((out as any).maxConcurrent).toBeUndefined();
    expect((out as any).organizationId).toBeUndefined();
  });

  it('tolera user ausente', () => {
    const out = mapMember({ id: 'mem2', userId: 'u2', role: 'AGENT', agentStatus: 'OFFLINE', joinedAt: new Date() } as any);
    expect(out.name).toBeNull();
    expect(out.email).toBeNull();
  });
});
