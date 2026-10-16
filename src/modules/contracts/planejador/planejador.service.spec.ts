import { NotFoundException } from '@nestjs/common';
import { PlanejadorService, generatePassword } from './planejador.service';

describe('generatePassword', () => {
  it('10 caracteres com minúscula, maiúscula, dígito e símbolo, via crypto', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(10);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[!@#$%&*]/);
    }
  });
});

describe('PlanejadorService', () => {
  const contract = {
    id: 'c1', organizationId: 'org1', fullName: 'Ana', cpf: '1', phone: '2', address: 'R', cep: '3', email: 'a@x.com',
    guideName: 'K', amount: '1', people: 1, disneyGuest: false, parkDates: [], requestedDates: '', createdAt: new Date(),
    planejadorPasswordEnc: null,
  };
  function make(client: any) {
    const prisma = {
      contract: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ ...contract, planejadorPasswordEnc: 'enc' }),
      },
    } as any;
    const crypto = { encrypt: jest.fn().mockReturnValue('enc'), decrypt: jest.fn().mockReturnValue('Senha#123') } as any;
    return { service: new PlanejadorService(prisma, crypto, client), prisma, crypto };
  }

  it('sucesso guarda a senha criptografada e marca sincronizado', async () => {
    const { service, prisma } = make({ createClient: jest.fn().mockResolvedValue(undefined) });
    await service.sync(contract as any);
    const data = prisma.contract.updateMany.mock.calls[0][0].data;
    expect(data.planejadorPasswordEnc).toBe('enc');
    expect(data.planejadorSyncedAt).toBeInstanceOf(Date);
    expect(data.planejadorError).toBeNull();
  });

  it('falha guarda o erro e mantém a senha (para tentar de novo com a mesma)', async () => {
    const { service, prisma } = make({ createClient: jest.fn().mockRejectedValue(new Error('Planejador respondeu 500')) });
    await service.sync(contract as any);
    const data = prisma.contract.updateMany.mock.calls[0][0].data;
    expect(data.planejadorError).toContain('500');
    expect(data.planejadorPasswordEnc).toBe('enc');
  });

  it('retry reaproveita a senha já guardada, sem gerar nova', async () => {
    const client = { createClient: jest.fn().mockResolvedValue(undefined) };
    const { service, crypto } = make(client);
    await service.sync({ ...contract, planejadorPasswordEnc: 'enc0' } as any);
    expect(crypto.decrypt).toHaveBeenCalledWith('enc0');
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(client.createClient.mock.calls[0][0].password).toBe('Senha#123');
  });

  it('o log e o erro guardado de uma falha não contêm a senha', async () => {
    const client = {
      createClient: jest.fn().mockRejectedValue(new Error('Planejador respondeu 400: invalid Senha#123 here')),
    };
    const { service, prisma } = make(client);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await service.sync({ ...contract, planejadorPasswordEnc: 'enc0' } as any);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Senha#123');
    expect(JSON.stringify(prisma.contract.updateMany.mock.calls)).not.toContain('Senha#123');
    expect(warn).toHaveBeenCalled();
  });

  it('nunca lança, mesmo se o banco falhar ao gravar o erro', async () => {
    const { service, prisma } = make({ createClient: jest.fn().mockRejectedValue(new Error('x')) });
    prisma.contract.updateMany.mockRejectedValue(new Error('db down'));
    await expect(service.sync(contract as any)).resolves.toBeUndefined();
  });

  it('revela a senha só da org certa e dentro do escopo do ator', async () => {
    const { service, prisma } = make({});
    const scope = { createdById: 'u1' };
    await expect(service.revealPassword('org1', 'c1', scope)).resolves.toEqual({
      email: 'a@x.com',
      password: 'Senha#123',
    });
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org1', AND: [scope] },
    });
  });

  it('fora do escopo (contrato não encontrado) responde 404', async () => {
    const { service, prisma } = make({});
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.revealPassword('org1', 'c1', { createdById: 'u2' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('contrato sem senha guardada responde 404', async () => {
    const { service, prisma } = make({});
    prisma.contract.findFirst.mockResolvedValue({ ...contract, planejadorPasswordEnc: null });
    await expect(service.revealPassword('org1', 'c1', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
