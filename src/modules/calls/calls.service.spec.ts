import { BadRequestException, BadGatewayException, NotFoundException } from '@nestjs/common';
import { CallsService } from './calls.service';
import { ConversationsService } from '../messaging/conversations/conversations.service';

/**
 * Instância REAL de ConversationsService (só com `prisma` montado) — mesmo
 * padrão de messages.access.spec.ts.
 */
function makeConversationsService(conversationFound: unknown = { id: 'conv1' }) {
  const guardPrisma: any = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversationFound) },
  };
  const svc: ConversationsService = Object.create(ConversationsService.prototype);
  Object.assign(svc, { prisma: guardPrisma });
  return { conversations: svc, guardPrisma };
}

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
  const { conversations, guardPrisma } = makeConversationsService(
    'conversationsGuardFinds' in over ? over.conversationsGuardFinds : { id: 'conv1' },
  );
  return {
    prisma, settings, sonax, realtime, created, guardPrisma,
    svc: new CallsService(prisma, settings, sonax, realtime, conversations),
  };
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

describe('CallsService — escopo por atribuição (AGENT só liga/lê ligação da própria conversa)', () => {
  it('initiateCall: AGENT + conversa de colega → NotFound, sem discar', async () => {
    const d = makeDeps({ conversationsGuardFinds: null });
    await expect(
      d.svc.initiateCall('conv1', 'agent-u1', 'org1', 'AGENT' as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(d.sonax.click2call).not.toHaveBeenCalled();
    expect(d.prisma.call.create).not.toHaveBeenCalled();
  });

  it('initiateCall: AGENT + conversa própria → prossegue e disca', async () => {
    const d = makeDeps({ conversationsGuardFinds: { id: 'conv1' } });
    const res = await d.svc.initiateCall('conv1', 'agent-u1', 'org1', 'AGENT' as any);
    expect(res.status).toBe('DIALING');
    expect(d.sonax.click2call).toHaveBeenCalled();
  });

  it('getLatestInsight: AGENT + conversa de colega → NotFound', async () => {
    const d = makeDeps({ conversationsGuardFinds: null });
    d.prisma.call = { findFirst: jest.fn().mockResolvedValue(null) };
    await expect(
      d.svc.getLatestInsight('conv1', 'org1', 'AGENT' as any, 'agent-u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getLatestInsight: AGENT + conversa própria → prossegue (sem call = hasCall:false)', async () => {
    const d = makeDeps({ conversationsGuardFinds: { id: 'conv1' } });
    d.prisma.call = { findFirst: jest.fn().mockResolvedValue(null) };
    const res = await d.svc.getLatestInsight('conv1', 'org1', 'AGENT' as any, 'agent-u1');
    expect(res).toEqual({ hasCall: false });
  });

  it('getTranscript: AGENT + conversa de colega → NotFound, sem consultar a Call', async () => {
    const d = makeDeps({ conversationsGuardFinds: null });
    d.prisma.call = { findFirst: jest.fn() };
    await expect(
      d.svc.getTranscript('conv1', 'call1', 'org1', 'AGENT' as any, 'agent-u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(d.prisma.call.findFirst).not.toHaveBeenCalled();
  });

  it('ADMIN não escopa (findFirst do guard sem assignedToId)', async () => {
    const d = makeDeps({ conversationsGuardFinds: { id: 'conv1' } });
    await d.svc.initiateCall('conv1', 'admin-u1', 'org1', 'ADMIN' as any);
    expect(d.guardPrisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'org1' },
    });
  });
});
