import { LegacyOwnerWriterService } from './legacy-owner-writer.service';

function make(
  overrides: { phone?: string | null; vendedor?: string | null; rowsUpdated?: number } = {},
) {
  const prisma = {
    contact: {
      findUnique: jest.fn().mockResolvedValue({
        phone: overrides.phone === undefined ? '5585999998888' : overrides.phone,
      }),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValue(
        overrides.vendedor === null ? [] : [{ vendedor: overrides.vendedor ?? 'Pedro' }],
      ),
    $executeRaw: jest.fn().mockResolvedValue(overrides.rowsUpdated ?? 1),
  } as any;
  return { service: new LegacyOwnerWriterService(prisma), prisma };
}

describe('LegacyOwnerWriterService.moveOwner', () => {
  it('passa o cliente da carteira para o vendedor novo', async () => {
    const { service, prisma } = make();

    const result = await service.moveOwner('contact-1', 'user-pedro');

    expect(result).toBe('moved');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // O telefone entra nas duas formas do 9º dígito, com o "+".
    const params = prisma.$executeRaw.mock.calls[0].flat();
    expect(JSON.stringify(params)).toContain('+5585999998888');
    expect(JSON.stringify(params)).toContain('+558599998888');
  });

  it('não mexe na carteira quando o atendente não é vendedor mapeado', async () => {
    const { service, prisma } = make({ vendedor: null });

    expect(await service.moveOwner('contact-1', 'user-admin')).toBe('skipped');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('não mexe na carteira quando o contato não tem telefone', async () => {
    const { service, prisma } = make({ phone: null });

    expect(await service.moveOwner('contact-1', 'user-pedro')).toBe('skipped');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('cliente fora da carteira: nenhuma linha muda', async () => {
    const { service } = make({ rowsUpdated: 0 });

    expect(await service.moveOwner('contact-1', 'user-pedro')).toBe('not-in-carteira');
  });
});
