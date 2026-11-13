import { Prisma } from '@prisma/client';
import { BotRepository } from './bot.repository';

function build(over: { active?: unknown; txError?: Error } = {}) {
  const tx = {
    mysteryShopperBotRun: {
      findFirst: jest.fn().mockResolvedValue(over.active ?? null),
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => {
      if (over.txError) throw over.txError;
      return fn(tx);
    }),
  };
  return { repo: new BotRepository(prisma as never), prisma, tx };
}

describe('BotRepository.createRunExclusive', () => {
  it('checa e cria na mesma transação Serializable', async () => {
    const { repo, prisma, tx } = build();
    await expect(repo.createRunExclusive('org', 'n1', 'persona')).resolves.toEqual({ id: 'r1' });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(tx.mysteryShopperBotRun.create).toHaveBeenCalled();
  });

  it('já existe execução viva: null e nada criado', async () => {
    const { repo, tx } = build({ active: { id: 'r0' } });
    await expect(repo.createRunExclusive('org', 'n1', 'persona')).resolves.toBeNull();
    expect(tx.mysteryShopperBotRun.create).not.toHaveBeenCalled();
  });

  it('conflito de serialização (P2034) vira null', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('conflito', { code: 'P2034', clientVersion: 'x' });
    const { repo } = build({ txError: err });
    await expect(repo.createRunExclusive('org', 'n1', 'persona')).resolves.toBeNull();
  });

  it('outros erros são repassados', async () => {
    const { repo } = build({ txError: new Error('db fora') });
    await expect(repo.createRunExclusive('org', 'n1', 'persona')).rejects.toThrow('db fora');
  });
});
