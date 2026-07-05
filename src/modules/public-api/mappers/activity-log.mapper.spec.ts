import { mapActivityLog } from './activity-log.mapper';

describe('mapActivityLog', () => {
  it('expõe campos públicos e omite metadata', () => {
    const out = mapActivityLog({
      id: 'a1', conversationId: 'cv1', actorId: 'u1', action: 'STATUS_CHANGED',
      fromValue: 'OPEN', toValue: 'CLOSED', metadata: { internal: true }, createdAt: new Date('2026-03-01'),
    } as any);
    expect(out).toEqual({
      id: 'a1', conversationId: 'cv1', actorId: 'u1', action: 'STATUS_CHANGED',
      fromValue: 'OPEN', toValue: 'CLOSED', createdAt: new Date('2026-03-01'),
    });
    expect((out as any).metadata).toBeUndefined();
  });
});
