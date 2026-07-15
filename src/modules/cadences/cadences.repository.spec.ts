import { CadencesRepository } from './cadences.repository';

describe('CadencesRepository.upsert — revive config', () => {
  it('persiste reviveEnabled e silenceWindowMinutes no create', async () => {
    const created: any = {};
    const tx = {
      cadence: {
        create: jest.fn(async ({ data }: any) => { Object.assign(created, data); return { id: 'cad1' }; }),
        findUnique: jest.fn().mockResolvedValue({ id: 'cad1' }),
      },
      cadenceStep: { createMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
    const repo = new CadencesRepository(prisma as any);
    await repo.upsert('o1', {
      name: 'C', trigger: 'BOTH', enabled: true, allowManual: true,
      reviveEnabled: false, silenceWindowMinutes: 720, steps: [],
    } as any);
    expect(created.reviveEnabled).toBe(false);
    expect(created.silenceWindowMinutes).toBe(720);
  });
});
