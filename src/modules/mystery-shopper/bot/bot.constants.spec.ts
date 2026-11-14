import { botTurnJobId } from './bot.constants';

describe('botTurnJobId', () => {
  test('não usa ":" (o BullMQ recusa id personalizado com dois-pontos)', () => {
    expect(botTurnJobId('r1')).toBe('bot-turn-r1');
    expect(botTurnJobId('r1')).not.toContain(':');
  });
});

describe('BOT_MAX_TOKENS', () => {
  it('deixa espaço para o raciocínio do MiniMax antes do JSON', () => {
    const { BOT_MAX_TOKENS } = jest.requireActual('./bot.constants');
    expect(BOT_MAX_TOKENS).toBeGreaterThanOrEqual(2000);
  });
});
