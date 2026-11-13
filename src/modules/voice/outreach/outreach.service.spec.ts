import { firstName, isOptedOut, OutreachService, PERMISSION_TEXT } from './outreach.service';

const H = 3600_000;
const NOW = new Date('2026-11-16T15:00:00-03:00'); // segunda 15h
const HOURS = { monday: { enabled: true, windows: [['09:00', '18:00']] } };

function conv(over: Record<string, unknown> = {}) {
  return {
    id: 'cv1',
    channelId: 'ch1',
    contactId: 'c1',
    assignedToId: 'renata',
    lastInboundAt: new Date(NOW.getTime() - 30 * H),
    metaWindowExpiresAt: null,
    channel: { type: 'WHATSAPP_OFFICIAL', config: { accessToken: 't', phoneNumberId: 'p' } },
    contact: { name: 'Kleber Silva', phone: '5511999990000', ctwaClidAt: null, metadata: {} },
    assignedTo: { name: 'Renata Souza' },
    ...over,
  };
}

function make(opts: { orgs?: any[]; proposals?: any[]; conv?: any; permission?: any; claimed?: number; dialerConfigured?: boolean } = {}) {
  const prisma = {
    organization: { findMany: jest.fn().mockResolvedValue(opts.orgs ?? []) },
    proposal: { findMany: jest.fn().mockResolvedValue(opts.proposals ?? []) },
    conversation: { findFirst: jest.fn().mockResolvedValue(opts.conv === undefined ? conv() : opts.conv) },
    userOrganization: { findFirst: jest.fn().mockResolvedValue({ workingHours: HOURS }) },
    voiceOutreach: {
      create: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
  } as any;
  const graph = {
    getPermission: jest.fn().mockResolvedValue(opts.permission ?? { canCall: true, canRequest: true, status: 'temporary' }),
    requestPermission: jest.fn().mockResolvedValue('wamid.1'),
  } as any;
  const dialer = { configured: opts.dialerConfigured ?? true, dial: jest.fn().mockResolvedValue(undefined) } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  return { svc: new OutreachService(prisma, graph, dialer, realtime), prisma, graph, dialer };
}

const ORG = { id: 'org1', settings: { enabled: true, delayHours: 24 }, tz: 'America/Sao_Paulo', hours: null };

describe('helpers', () => {
  it('primeiro nome e opt-out', () => {
    expect(firstName('  Kleber Silva ')).toBe('Kleber');
    expect(firstName('5511999')).toBeNull();
    expect(isOptedOut({ voiceCallsOptOut: true })).toBe(true);
    expect(isOptedOut({})).toBe(false);
  });
});

describe('OutreachService.sweep', () => {
  it('chave desligada (padrão): não procura cotação, não pede permissão, não liga', async () => {
    const { svc, prisma, graph, dialer } = make({
      orgs: [{ id: 'org1', settings: {}, aiTimezone: null, aiBusinessHours: null }, { id: 'org2', settings: { voiceCalls: { enabled: false } } }],
    });
    await svc.sweep(NOW);
    expect(prisma.proposal.findMany).not.toHaveBeenCalled();
    expect(graph.requestPermission).not.toHaveBeenCalled();
    expect(dialer.dial).not.toHaveBeenCalled();
  });
});

describe('OutreachService.requestPermissions', () => {
  const recente = [{ id: 'pr1', conversationId: 'cv1', contactId: 'c1', createdAt: new Date(NOW.getTime() - 5 * 60_000) }];

  it('com a janela aberta e sem permissão, pede e registra PEDIDA + aviso na conversa', async () => {
    const { svc, prisma, graph } = make({
      proposals: recente,
      conv: conv({ lastInboundAt: new Date(NOW.getTime() - H) }),
      permission: { canCall: false, canRequest: true, status: 'no_permission' },
    });
    await svc.requestPermissions('org1', NOW);
    expect(graph.requestPermission).toHaveBeenCalledWith(expect.anything(), '5511999990000', PERMISSION_TEXT);
    expect(prisma.voiceOutreach.create).toHaveBeenCalledWith({ data: expect.objectContaining({ proposalId: 'pr1', permissionStatus: 'PEDIDA' }) });
    expect(prisma.message.create).toHaveBeenCalled();
  });

  it('janela fechada ou já com permissão: não pede, registra o motivo', async () => {
    const fechada = make({ proposals: recente, conv: conv({ lastInboundAt: new Date(NOW.getTime() - 48 * H) }) });
    await fechada.svc.requestPermissions('org1', NOW);
    expect(fechada.graph.requestPermission).not.toHaveBeenCalled();
    expect(fechada.prisma.voiceOutreach.create).toHaveBeenCalledWith({ data: expect.objectContaining({ permissionStatus: 'PULADA', permissionNote: 'JANELA_FECHADA' }) });

    const jaTem = make({ proposals: recente, conv: conv({ lastInboundAt: new Date(NOW.getTime() - H) }) });
    await jaTem.svc.requestPermissions('org1', NOW);
    expect(jaTem.graph.requestPermission).not.toHaveBeenCalled();
    expect(jaTem.prisma.voiceOutreach.create).toHaveBeenCalledWith({ data: expect.objectContaining({ permissionNote: 'JA_TEM_PERMISSAO' }) });
  });
});

describe('OutreachService.callDue', () => {
  const vencida = [{ id: 'pr1', conversationId: 'cv1', contactId: 'c1', createdAt: new Date(NOW.getTime() - 25 * H) }];

  it('24h sem resposta, com permissão e no expediente: liga com a missão de retorno de cotação', async () => {
    const { svc, prisma, dialer } = make({ proposals: vencida });
    await svc.callDue(ORG, NOW);
    expect(dialer.dial).toHaveBeenCalledWith({
      room: 'retorno-pr1',
      phoneE164: '+5511999990000',
      missionMetadata: JSON.stringify({ missao: 'retorno_cotacao', cliente: 'Kleber', vendedor: 'Renata', conversationId: 'cv1' }),
      contactName: 'Kleber Silva',
    });
    expect(prisma.voiceOutreach.update).toHaveBeenCalledWith({ where: { proposalId: 'pr1' }, data: expect.objectContaining({ callStatus: 'LIGOU', room: 'retorno-pr1' }) });
  });

  it('sem permissão não liga; registra SEM_PERMISSAO', async () => {
    const { svc, prisma, dialer } = make({ proposals: vencida, permission: { canCall: false, canRequest: true, status: 'no_permission' } });
    await svc.callDue(ORG, NOW);
    expect(dialer.dial).not.toHaveBeenCalled();
    expect(prisma.voiceOutreach.update).toHaveBeenCalledWith({ where: { proposalId: 'pr1' }, data: { callStatus: 'SEM_PERMISSAO', callNote: 'no_permission' } });
  });

  it('outra varredura já pegou a cotação: não disca de novo', async () => {
    const { svc, dialer, graph } = make({ proposals: vencida, claimed: 0 });
    await svc.callDue(ORG, NOW);
    expect(graph.getPermission).not.toHaveBeenCalled();
    expect(dialer.dial).not.toHaveBeenCalled();
  });

  it('LiveKit sem configuração: registra FALHOU, sem discar', async () => {
    const { svc, prisma, dialer } = make({ proposals: vencida, dialerConfigured: false });
    await svc.callDue(ORG, NOW);
    expect(dialer.dial).not.toHaveBeenCalled();
    expect(prisma.voiceOutreach.update).toHaveBeenCalledWith({ where: { proposalId: 'pr1' }, data: { callStatus: 'FALHOU', callNote: 'LIVEKIT_NAO_CONFIGURADO' } });
  });

  it('cliente respondeu depois da cotação: pula; fora do expediente: espera sem gravar', async () => {
    const respondeu = make({ proposals: vencida, conv: conv({ lastInboundAt: new Date(NOW.getTime() - H) }) });
    await respondeu.svc.callDue(ORG, NOW);
    expect(respondeu.prisma.voiceOutreach.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { callStatus: 'PULADA', callNote: 'CLIENTE_RESPONDEU' } }));

    const noite = make({ proposals: vencida });
    await noite.svc.callDue(ORG, new Date('2026-11-16T21:00:00-03:00'));
    expect(noite.dialer.dial).not.toHaveBeenCalled();
    expect(noite.prisma.voiceOutreach.upsert).not.toHaveBeenCalled();
  });
});
