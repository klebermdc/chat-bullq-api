import { botTurnJobId } from './bot.constants';

describe('botTurnJobId', () => {
  test('não usa ":" (o BullMQ recusa id personalizado com dois-pontos)', () => {
    expect(botTurnJobId('r1')).toBe('bot-turn-r1');
    expect(botTurnJobId('r1')).not.toContain(':');
  });
});
