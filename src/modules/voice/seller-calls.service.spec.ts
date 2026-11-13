import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { canSellerCall, parseSellerCallSettings, SellerCallsService } from './seller-calls.service';

const RENATA = { userId: 'renata', role: OrgRole.AGENT, name: 'Renata' };
const PEDRO = { userId: 'pedro', role: OrgRole.AGENT, name: 'Pedro' };
const ADMIN = { userId: 'adm', role: OrgRole.ADMIN, name: 'Gestão' };

function make(opts: { enabled?: boolean; permission?: any; configured?: boolean; lastInboundAt?: Date | null; dialError?: Error } = {}) {
  const prisma = {
    organization: { findUnique: jest.fn().mockResolvedValue({ settings: { sellerCalls: { enabled: opts.enabled ?? true } } }) },
    conversation: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'cv1', channelId: 'ch1', contactId: 'c1', assignedToId: 'renata',
        lastInboundAt: opts.lastInboundAt === undefined ? new Date() : opts.lastInboundAt, metaWindowExpiresAt: null,
        channel: { type: 'WHATSAPP_OFFICIAL', config: {} },
        contact: { name: 'Kleber', phone: '5511999990000', ctwaClidAt: null },
      }),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
  } as any;
  const graph = {
    getPermission: jest.fn().mockResolvedValue(opts.permission ?? { canCall: true, canRequest: false, status: 'permanent' }),
    requestPermission: jest.fn().mockResolvedValue('wamid'),
  } as any;
  const dialer = {
    configured: opts.configured ?? true,
    dialForSeller: opts.dialError ? jest.fn().mockRejectedValue(opts.dialError) : jest.fn().mockResolvedValue(undefined),
    dispatchAgent: jest.fn().mockResolvedValue(undefined),
    joinAccess: jest.fn().mockReturnValue({ url: 'wss://lk', token: 'tok' }),
    endRoom: jest.fn().mockResolvedValue(undefined),
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const records = { open: jest.fn().mockResolvedValue('call1'), fail: jest.fn().mockResolvedValue(undefined) } as any;
  return { svc: new SellerCallsService(prisma, graph, dialer, realtime, records), prisma, graph, dialer, records };
}

describe('regras', () => {
  it('chave desligada por padrão; liga o dono da conversa e a gestão', () => {
    expect(parseSellerCallSettings({})).toEqual({ enabled: false });
    expect(parseSellerCallSettings({ sellerCalls: { enabled: true } })).toEqual({ enabled: true });
    expect(canSellerCall(RENATA, 'renata')).toBe(true);
    expect(canSellerCall(PEDRO, 'renata')).toBe(false);
    expect(canSellerCall(ADMIN, null)).toBe(true);
  });
});

describe('SellerCallsService', () => {
  it('chave desligada ou vendedor de outra conversa: barra', async () => {
    await expect(make({ enabled: false }).svc.check('org1', 'cv1', RENATA)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make().svc.start('org1', 'cv1', PEDRO)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('com permissão: disca para o cliente e devolve o acesso do vendedor à sala', async () => {
    const { svc, dialer } = make();
    const r = await svc.start('org1', 'cv1', RENATA);
    expect(dialer.dialForSeller).toHaveBeenCalledWith(expect.objectContaining({ phoneE164: '+5511999990000', room: expect.stringMatching(/^vendedor-cv1-\d+$/) }));
    expect(dialer.joinAccess).toHaveBeenCalledWith(expect.objectContaining({ identity: 'vendedor-renata', name: 'Renata' }));
    expect(r).toMatchObject({ url: 'wss://lk', token: 'tok', callId: 'call1', room: expect.stringMatching(/^vendedor-cv1-/) });
  });

  it('abre o registro da ligação e põe o transcritor na sala antes de discar', async () => {
    const { svc, dialer, records } = make();
    const r = await svc.start('org1', 'cv1', RENATA);
    expect(records.open).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org1', agentId: 'renata', numero: '5511999990000' }));
    expect(dialer.dispatchAgent).toHaveBeenCalledWith(r.room, JSON.stringify({ missao: 'transcrever_vendedor', callId: 'call1' }));
    expect(dialer.dispatchAgent.mock.invocationCallOrder[0]).toBeLessThan(dialer.dialForSeller.mock.invocationCallOrder[0]);
  });

  it('transcritor fora do ar não impede a ligação', async () => {
    const { svc, dialer } = make();
    dialer.dispatchAgent.mockRejectedValue(new Error('LiveKit fora'));
    await expect(svc.start('org1', 'cv1', RENATA)).resolves.toMatchObject({ callId: 'call1' });
    expect(dialer.dialForSeller).toHaveBeenCalled();
  });

  it('discagem falhou: marca a ligação como falha, fecha a sala e repassa o erro', async () => {
    const { svc, dialer, records } = make({ dialError: new Error('Meta 403') });
    await expect(svc.start('org1', 'cv1', RENATA)).rejects.toThrow('Meta 403');
    expect(records.fail).toHaveBeenCalledWith('call1');
    expect(dialer.endRoom).toHaveBeenCalled();
  });

  it('sem permissão do cliente: não disca', async () => {
    const { svc, dialer } = make({ permission: { canCall: false, canRequest: true, status: 'no_permission' } });
    await expect(svc.start('org1', 'cv1', RENATA)).rejects.toBeInstanceOf(BadRequestException);
    expect(dialer.dialForSeller).not.toHaveBeenCalled();
  });

  it('pede permissão só com a janela aberta', async () => {
    const aberta = make({ permission: { canCall: false, canRequest: true, status: 'no_permission' } });
    await aberta.svc.requestPermission('org1', 'cv1', RENATA);
    expect(aberta.graph.requestPermission).toHaveBeenCalled();
    const fechada = make({ permission: { canCall: false, canRequest: true, status: 'no_permission' }, lastInboundAt: new Date(Date.now() - 48 * 3600_000) });
    await expect(fechada.svc.requestPermission('org1', 'cv1', RENATA)).rejects.toThrow('Janela de 24h fechada');
  });

  it('encerra só a sala desta conversa', async () => {
    const { svc, dialer } = make();
    await svc.end('org1', 'cv1', 'vendedor-cv1-123', RENATA);
    expect(dialer.endRoom).toHaveBeenCalledWith('vendedor-cv1-123');
    await expect(svc.end('org1', 'cv1', 'vendedor-outra-1', RENATA)).rejects.toBeInstanceOf(BadRequestException);
  });
});
