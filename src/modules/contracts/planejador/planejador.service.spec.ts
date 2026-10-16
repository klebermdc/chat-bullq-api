import { NotFoundException } from '@nestjs/common';
import { PlanejadorConfigError, PlanejadorHttpError } from './planejador.client';
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

const contract = {
  id: 'c1', organizationId: 'org1', fullName: 'Ana', cpf: '12345678901', phone: '2', address: 'R', cep: '3',
  email: 'a@x.com', guideName: 'K', amount: '1', people: 1, disneyGuest: false, parkDates: [], requestedDates: '',
  createdAt: new Date(), planejadorPasswordEnc: null, planejadorSyncedAt: null, planejadorError: null,
};

/** Mocks que registram a ordem das chamadas em `order`. */
function make(createClient: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
  const order: string[] = [];
  const prisma = {
    contract: {
      updateMany: jest.fn().mockImplementation(async () => {
        order.push('updateMany');
        return { count: 1 };
      }),
      findFirst: jest.fn().mockImplementation(async () => {
        order.push('findFirst');
        return { ...contract, planejadorPasswordEnc: 'enc' };
      }),
    },
  } as any;
  const crypto = {
    encrypt: jest.fn().mockReturnValue('enc'),
    decrypt: jest.fn().mockImplementation((v: string) => (v === 'enc-outro' ? 'Outra#999' : 'Senha#123')),
  } as any;
  const client = {
    createClient: jest.fn().mockImplementation(async (p: unknown) => {
      order.push('createClient');
      return createClient(p);
    }),
  } as any;
  const service = new PlanejadorService(prisma, crypto, client);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  const lastData = () => prisma.contract.updateMany.mock.calls.at(-1)[0].data;
  return { service, prisma, crypto, client, order, warn, error, lastData };
}

describe('PlanejadorService.sync (idempotência)', () => {
  it('já sincronizado e sem force: não chama o Planejador nem o banco', async () => {
    const { service, client, prisma } = make();
    await service.sync({ ...contract, planejadorSyncedAt: new Date(), planejadorPasswordEnc: 'enc' } as any);
    expect(client.createClient).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('já sincronizado com force: reenvia com a senha guardada', async () => {
    const { service, client, crypto } = make();
    await service.sync({ ...contract, planejadorSyncedAt: new Date(), planejadorPasswordEnc: 'enc0' } as any, { force: true });
    expect(crypto.decrypt).toHaveBeenCalledWith('enc0');
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(client.createClient).toHaveBeenCalledTimes(1);
  });
});

describe('PlanejadorService.sync (senha gravada antes)', () => {
  it('sem senha: grava a cifrada só se ainda nula, relê e só então chama o Planejador', async () => {
    const { service, prisma, client, order } = make();
    await service.sync(contract as any);
    expect(order.slice(0, 3)).toEqual(['updateMany', 'findFirst', 'createClient']);
    expect(prisma.contract.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'c1', organizationId: 'org1', planejadorPasswordEnc: null },
      data: { planejadorPasswordEnc: 'enc' },
    });
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', organizationId: 'org1' } });
    expect(client.createClient.mock.calls[0][0].password).toBe('Senha#123');
  });

  it('corrida: outro sync gravou antes (count 0) e a senha relida é a usada', async () => {
    const { service, prisma, client, crypto } = make();
    prisma.contract.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.contract.findFirst.mockResolvedValueOnce({ ...contract, planejadorPasswordEnc: 'enc-outro' });
    await service.sync(contract as any);
    expect(crypto.decrypt).toHaveBeenCalledWith('enc-outro');
    expect(client.createClient.mock.calls[0][0].password).toBe('Outra#999');
  });

  it('releitura sem senha: registra falha genérica e não chama o Planejador', async () => {
    const { service, prisma, client, lastData } = make();
    prisma.contract.findFirst.mockResolvedValueOnce({ ...contract, planejadorPasswordEnc: null });
    await service.sync(contract as any);
    expect(client.createClient).not.toHaveBeenCalled();
    expect(lastData()).toEqual({ planejadorError: expect.any(String), planejadorSyncedAt: null });
  });

  it('retry com senha já guardada não gera nova nem relê', async () => {
    const { service, crypto, client, prisma } = make();
    await service.sync({ ...contract, planejadorPasswordEnc: 'enc0' } as any);
    expect(crypto.decrypt).toHaveBeenCalledWith('enc0');
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(prisma.contract.findFirst).not.toHaveBeenCalled();
    expect(client.createClient.mock.calls[0][0].password).toBe('Senha#123');
  });
});

describe('PlanejadorService.sync (resultado)', () => {
  it('sucesso marca sincronizado e limpa o erro', async () => {
    const { service, lastData } = make();
    await service.sync(contract as any);
    expect(lastData()).toEqual({ planejadorSyncedAt: expect.any(Date), planejadorError: null });
  });

  it('falha HTTP: mensagem genérica com o status, syncedAt nulo, sem corpo', async () => {
    const { service, lastData, prisma } = make(jest.fn().mockRejectedValue(new PlanejadorHttpError(500)));
    await service.sync(contract as any);
    expect(lastData()).toEqual({ planejadorError: 'Planejador respondeu 500', planejadorSyncedAt: null });
    expect(prisma.contract.updateMany.mock.calls.at(-1)[0].where).toEqual({
      id: 'c1', organizationId: 'org1', planejadorSyncedAt: null,
    });
  });

  it('force com falha zera o syncedAt antigo', async () => {
    const { service, lastData, prisma } = make(jest.fn().mockRejectedValue(new PlanejadorHttpError(502)));
    await service.sync({ ...contract, planejadorSyncedAt: new Date(), planejadorPasswordEnc: 'enc0' } as any, { force: true });
    expect(lastData()).toEqual({ planejadorError: 'Planejador respondeu 502', planejadorSyncedAt: null });
    expect(prisma.contract.updateMany.mock.calls.at(-1)[0].where).toEqual({ id: 'c1', organizationId: 'org1' });
  });

  it('409: login já existe para este e-mail', async () => {
    const { service, lastData } = make(jest.fn().mockRejectedValue(new PlanejadorHttpError(409)));
    await service.sync(contract as any);
    expect(lastData()).toEqual({ planejadorError: 'Login já existe no Planejador para este e-mail', planejadorSyncedAt: null });
  });

  it('timeout ou rede: indisponível, sem a mensagem original', async () => {
    const err = Object.assign(new Error('fetch failed a@x.com 123.456.789-01'), { name: 'TimeoutError' });
    const { service, lastData, warn } = make(jest.fn().mockRejectedValue(err));
    await service.sync(contract as any);
    expect(lastData()).toEqual({ planejadorError: 'Planejador indisponível (timeout/rede)', planejadorSyncedAt: null });
    expect(warn).toHaveBeenCalledWith('contract_planejador_failed contract=c1 status=- code=TimeoutError');
  });

  it('erro de configuração fica registrado como tal (sem dado do cliente)', async () => {
    const { service, lastData } = make(jest.fn().mockRejectedValue(new PlanejadorConfigError('PLANEJADOR_API_KEY não configurada')));
    await service.sync(contract as any);
    expect(lastData()).toEqual({ planejadorError: 'PLANEJADOR_API_KEY não configurada', planejadorSyncedAt: null });
  });

  it('log e erro guardado nunca têm senha, e-mail, CPF ou corpo da resposta', async () => {
    const leak = Object.assign(new PlanejadorHttpError(400), { message: 'invalid Senha#123 a@x.com 123.456.789-01' });
    const { service, warn, error, prisma } = make(jest.fn().mockRejectedValue(leak));
    await service.sync(contract as any);
    expect(warn).toHaveBeenCalledWith('contract_planejador_failed contract=c1 status=400 code=http');
    const everything = JSON.stringify([warn.mock.calls, error.mock.calls, prisma.contract.updateMany.mock.calls]);
    for (const secret of ['Senha#123', 'a@x.com', '123.456.789-01']) expect(everything).not.toContain(secret);
  });

  it('nunca lança, mesmo se o banco falhar', async () => {
    const { service, prisma, error } = make(jest.fn().mockRejectedValue(new Error('x')));
    prisma.contract.updateMany.mockRejectedValue(new Error('db down'));
    await expect(service.sync(contract as any)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe('PlanejadorService.revealPassword', () => {
  it('revela a senha só da org certa e dentro do escopo do ator', async () => {
    const { service, prisma } = make();
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
    const { service, prisma } = make();
    prisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.revealPassword('org1', 'c1', { createdById: 'u2' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('contrato sem senha guardada responde 404', async () => {
    const { service, prisma } = make();
    prisma.contract.findFirst.mockResolvedValue({ ...contract, planejadorPasswordEnc: null });
    await expect(service.revealPassword('org1', 'c1', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
