import { BadRequestException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { ContractTokenGuard } from './contract-token.guard';

const TOKEN = 'a'.repeat(43);

function ctx(params: Record<string, unknown>, headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params, headers }) }),
  } as unknown as ExecutionContext;
}

function make(found: unknown) {
  const prisma = { contract: { findUnique: jest.fn().mockResolvedValue(found) } } as any;
  return { guard: new ContractTokenGuard(prisma), prisma };
}

describe('ContractTokenGuard', () => {
  it('token existente libera, buscando só o id', async () => {
    const { guard, prisma } = make({ id: 'c1' });
    await expect(guard.canActivate(ctx({ token: TOKEN }))).resolves.toBe(true);
    expect(prisma.contract.findUnique).toHaveBeenCalledWith({ where: { acceptanceToken: TOKEN }, select: { id: true } });
  });

  it('token inexistente dá 404', async () => {
    const { guard } = make(null);
    await expect(guard.canActivate(ctx({ token: TOKEN }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('token malformado dá 400 sem consultar o banco', async () => {
    const { guard, prisma } = make({ id: 'c1' });
    for (const token of [undefined, '', '../x', 'a'.repeat(19), 'a'.repeat(65), `${'a'.repeat(20)}.`]) {
      await expect(guard.canActivate(ctx({ token }))).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.contract.findUnique).not.toHaveBeenCalled();
  });

  it('não exige JWT: sem Authorization e sem req.user libera com token válido', async () => {
    const { guard } = make({ id: 'c1' });
    await expect(guard.canActivate(ctx({ token: TOKEN }, {}))).resolves.toBe(true);
  });
});
