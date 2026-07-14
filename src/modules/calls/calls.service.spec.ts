import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { CallsService } from './calls.service';

function makeDeps(over: any = {}) {
  const created: any = {};
  const prisma = {
    conversation: {
      findFirst: jest.fn(async () => over.conversation ?? {
        id: 'conv1', organizationId: 'org1',
        contact: { phone: '11999998888' },
      }),
    },
    userOrganization: {
      findUnique: jest.fn(async () => over.member ?? { sonaxRamal: '101' }),
    },
    call: {
      create: jest.fn(async ({ data }) => { created.call = { id: 'call1', ...data }; return created.call; }),
      update: jest.fn(async ({ data }) => { created.callUpdate = data; return { id: 'call1', ...data }; }),
    },
    message: {
      create: jest.fn(async ({ data }) => ({ id: 'msg1', ...data })),
      update: jest.fn(async ({ data }) => ({ id: 'msg1', ...data })),
    },
  } as any;
  const settings = {
    getDecryptedForDial: jest.fn(async () => ('dial' in over ? over.dial : { idCliente: '1', token: 'TK', click2callBaseUrl: 'https://x' })),
  } as any;
  const sonax = { click2call: jest.fn(async () => undefined), ...over.sonax } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  return { prisma, settings, sonax, realtime, created, svc: new CallsService(prisma, settings, sonax, realtime) };
}

describe('CallsService.initiateCall', () => {
  it('cria Call DIALING + Message SYSTEM e dispara o click2call com var_1=call.id', async () => {
    const d = makeDeps();
    const res = await d.svc.initiateCall('conv1', 'user1', 'org1');
    expect(res.status).toBe('DIALING');
    expect(d.sonax.click2call).toHaveBeenCalledWith(expect.objectContaining({ ramal: '101', var1: 'call1', numero: '5511999998888' }));
    expect(d.prisma.message.create).toHaveBeenCalled();
  });

  it('400 quando a conversa não tem telefone', async () => {
    const d = makeDeps({ conversation: { id: 'conv1', organizationId: 'org1', contact: { phone: null } } });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 quando Sonax não está habilitada', async () => {
    const d = makeDeps({ dial: null });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 quando o atendente não tem ramal', async () => {
    const d = makeDeps({ member: { sonaxRamal: null } });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('502 e marca Call FAILED quando a Sonax recusa', async () => {
    const d = makeDeps({ sonax: { click2call: jest.fn(async () => { throw new Error('Sonax 404'); }) } });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadGatewayException);
    expect(d.created.callUpdate.status).toBe('FAILED');
  });
});
