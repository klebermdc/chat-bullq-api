import { ManagerBotAccess } from './manager-bot.access';
import { ManagerBotService } from './manager-bot.service';
import { isValidWebhook } from './telegram/telegram.webhook.controller';

const TZ = 'America/Sao_Paulo';
const ORG = 'org-ofp';

function settings(over: Record<string, unknown> = {}) {
  return { managerBot: { enabled: true, chats: [{ chatId: '1', name: 'Kleber' }], linkCode: 'segredo', ...over } };
}

function costsReport(cost: number) {
  return { from: '2026-11-11', to: '2026-11-11', tz: TZ, channels: [], totalsByCurrency: [{ currency: 'BRL', cost }] };
}

function setup(opts: { settings?: unknown; telegramOk?: boolean; claim?: boolean } = {}) {
  const org = { id: ORG, settings: opts.settings ?? settings(), tz: TZ, orgHours: null };
  const orgs = { listActiveOrgs: jest.fn(async () => [org]) };
  const reports = {
    opening: jest.fn(async () => 'ABERTURA'),
    closing: jest.fn(async (_o: unknown, _n: Date, partial: boolean) => (partial ? 'PARCIAL' : 'FECHAMENTO')),
    weekly: jest.fn(async () => 'SEMANAL'),
    overdue: jest.fn(async () => [] as Array<{ contactName: string; agentName: string | null; businessMinutes: number }>),
    queue: jest.fn(async () => ({ unassigned: 0, oldestSince: null })),
    team: jest.fn(async () => []),
    costs: jest.fn(async () => 'CUSTOS'),
    todayCosts: jest.fn(async () => costsReport(0)),
  };
  const telegram = {
    isConfigured: jest.fn(() => opts.telegramOk ?? true),
    sendMessage: jest.fn(async () => ({ ok: true })),
    sendTyping: jest.fn(async () => undefined),
  };
  const errors = { report: jest.fn() };
  const throttle = { claim: jest.fn(async () => opts.claim ?? true) };
  const service = new ManagerBotService(
    orgs as never,
    reports as never,
    telegram as never,
    errors as never,
    throttle as never,
  );
  const repository = { addChat: jest.fn(async () => undefined) };
  const assistant = {
    ask: jest.fn(async () => 'SLA de hoje: 90% <bom>'),
    reset: jest.fn(async () => undefined),
  };
  const access = new ManagerBotAccess(service, repository as never, assistant as never);
  return { service, access, reports, telegram, errors, throttle, repository, assistant };
}

// 11/11/2026 (quarta). SP = UTC-3.
const AT_0900 = new Date('2026-11-11T12:00:00Z');
const AT_2210 = new Date('2026-11-12T01:10:00Z');
const AT_1500 = new Date('2026-11-11T18:00:00Z');
const AT_2330 = new Date('2026-11-12T02:30:00Z');
const MONDAY_0905 = new Date('2026-11-16T12:05:00Z');

describe('ManagerBotService.runTick', () => {
  it('sem token do Telegram não faz nada', async () => {
    const s = setup({ telegramOk: false });
    await s.service.runTick(AT_0900);
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('sem chats cadastrados não envia', async () => {
    const s = setup({ settings: settings({ chats: [] }) });
    await s.service.runTick(AT_0900);
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('manda a abertura às 9h para todos os chats', async () => {
    const s = setup({ settings: settings({ chats: [{ chatId: '1', name: 'A' }, { chatId: '2', name: 'B' }] }) });
    await s.service.runTick(AT_0900);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', 'ABERTURA');
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('2', 'ABERTURA');
    expect(s.throttle.claim).toHaveBeenCalledWith(`abertura:${ORG}:2026-11-11`, expect.any(Number));
  });

  it('manda o fechamento às 22h10 e o semanal na segunda', async () => {
    const s = setup();
    await s.service.runTick(AT_2210);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', 'FECHAMENTO');
    await s.service.runTick(MONDAY_0905);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', 'SEMANAL');
  });

  it('trava perdida não reenvia', async () => {
    const s = setup({ claim: false });
    await s.service.runTick(AT_0900);
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('alerta de SLA no meio do dia, nunca no silêncio', async () => {
    const s = setup();
    s.reports.overdue.mockResolvedValue([{ contactName: 'Ana', agentName: 'Pedro', businessMinutes: 40 }]);
    await s.service.runTick(AT_2330);
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
    await s.service.runTick(AT_1500);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', expect.stringContaining('Ana — Pedro'));
  });

  it('falha em um passo não impede os outros e vira relatório de erro', async () => {
    const s = setup();
    s.reports.overdue.mockRejectedValue(new Error('banco fora'));
    s.reports.queue.mockResolvedValue({ unassigned: 50, oldestSince: null });
    await s.service.runTick(AT_1500);
    expect(s.errors.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('banco fora') }));
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', expect.stringContaining('Fila sem dono com 50'));
  });

  it('custo do dia acima do teto avisa uma vez por dia', async () => {
    const s = setup();
    s.reports.todayCosts.mockResolvedValue(costsReport(130.5));
    await s.service.runTick(AT_1500);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', expect.stringContaining('passou do teto'));
    expect(s.throttle.claim).toHaveBeenCalledWith(`custo:${ORG}:2026-11-11`, expect.any(Number));
  });

  it('custo abaixo do teto ou teto zero não avisa', async () => {
    const s = setup();
    s.reports.todayCosts.mockResolvedValue(costsReport(119.99));
    await s.service.runTick(AT_1500);
    const z = setup({ settings: settings({ costAlertDaily: 0 }) });
    z.reports.todayCosts.mockResolvedValue(costsReport(999));
    await z.service.runTick(AT_1500);
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
    expect(z.reports.todayCosts).not.toHaveBeenCalled();
  });

  it('envio que falha vira aviso no painel de erros', async () => {
    const s = setup();
    s.telegram.sendMessage.mockResolvedValue({ ok: false, error: 'blocked' } as never);
    await s.service.runTick(AT_0900);
    expect(s.errors.report).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('blocked') }));
  });
});

describe('ManagerBotAccess', () => {
  const msg = (chatId: number, text: string) => ({
    message: { chat: { id: chatId }, from: { first_name: 'Renata' }, text },
  });

  it('código certo cadastra, troca o código e dá boas-vindas', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(99, '/start segredo'), AT_1500);
    expect(s.repository.addChat).toHaveBeenCalledWith(ORG, { chatId: '99', name: 'Renata' }, expect.stringMatching(/^[0-9a-f]{12}$/));
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('99', expect.stringContaining('Olá, Renata'));
  });

  it('código errado é ignorado', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(99, '/start chute'), AT_1500);
    expect(s.repository.addChat).not.toHaveBeenCalled();
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('chat desconhecido sem código não recebe nada', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(99, '/placar'), AT_1500);
    expect(s.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('/custos devolve o relatório de custos', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(1, '/custos'), AT_1500);
    expect(s.reports.costs).toHaveBeenCalled();
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', 'CUSTOS');
  });

  it('/placar devolve o placar parcial só para quem pediu', async () => {
    const s = setup({ settings: settings({ chats: [{ chatId: '1', name: 'K' }, { chatId: '2', name: 'R' }] }) });
    await s.access.handleUpdate(msg(1, '/placar'), AT_1500);
    expect(s.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', 'PARCIAL');
  });

  it('texto livre vai para o assistente, com "digitando" e resposta escapada', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(1, 'como foi hoje?'), AT_1500);
    expect(s.telegram.sendTyping).toHaveBeenCalledWith('1');
    expect(s.assistant.ask).toHaveBeenCalledWith(expect.objectContaining({ id: ORG }), '1', 'como foi hoje?', AT_1500);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', 'SLA de hoje: 90% &lt;bom&gt;');
  });

  it('comando desconhecido recebe a ajuda; /nova zera o contexto', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(1, '/xyz'), AT_1500);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', expect.stringContaining('/placar'));
    await s.access.handleUpdate(msg(1, '/nova'), AT_1500);
    expect(s.assistant.reset).toHaveBeenCalledWith(ORG, '1');
  });

  it('chat desconhecido não chega ao assistente', async () => {
    const s = setup();
    await s.access.handleUpdate(msg(99, 'quanto vendemos?'), AT_1500);
    expect(s.assistant.ask).not.toHaveBeenCalled();
  });

  it('erro ao montar o relatório responde com aviso, sem número inventado', async () => {
    const s = setup();
    s.reports.closing.mockRejectedValue(new Error('x'));
    await s.access.handleUpdate(msg(1, '/placar'), AT_1500);
    expect(s.telegram.sendMessage).toHaveBeenCalledWith('1', expect.stringContaining('Não consegui buscar'));
  });
});

describe('isValidWebhook', () => {
  it('exige o segredo no caminho e no header', () => {
    expect(isValidWebhook('s3', 's3', 's3')).toBe(true);
    expect(isValidWebhook('s3', undefined, 's3')).toBe(false);
    expect(isValidWebhook('x', 's3', 's3')).toBe(false);
    expect(isValidWebhook('s3', 's3', undefined)).toBe(false);
  });
});
