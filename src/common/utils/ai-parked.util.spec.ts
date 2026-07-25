import { isAiParked } from './ai-parked.util';

describe('isAiParked', () => {
  const parked = { assignedToId: null, awaitingHumanReply: false, aiEnabled: null };

  it('true quando sem humano e IA não desligada', () => {
    expect(isAiParked(parked)).toBe(true);
    expect(isAiParked({ ...parked, aiEnabled: true })).toBe(true);
  });

  it('false quando tem vendedor atribuído', () => {
    expect(isAiParked({ ...parked, assignedToId: 'u1' })).toBe(false);
  });

  it('false quando aguardando humano', () => {
    expect(isAiParked({ ...parked, awaitingHumanReply: true })).toBe(false);
  });

  it('false quando a IA foi desligada na conversa (aiEnabled=false)', () => {
    expect(isAiParked({ ...parked, aiEnabled: false })).toBe(false);
  });
});
