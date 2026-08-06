import { WebhookGatewayController } from './webhook-gateway.controller';
import { ERROR_CODES } from '../error-reporter/error-codes';

const ativo = {
  id: 'ch1',
  name: 'Comercial',
  organizationId: 'org1',
  isActive: true,
  webhookSecret: 'segredo',
};
const inativo = {
  id: 'ch2',
  name: 'Suporte',
  organizationId: 'org1',
  isActive: false,
  webhookSecret: 'segredo',
};

const build = () => {
  const adapter = {
    extractLocators: jest.fn().mockReturnValue([{ sessionId: 'S1' }]),
    matchesChannel: jest.fn().mockReturnValue(true),
    validateWebhook: jest.fn().mockReturnValue(true),
    parseWebhook: jest.fn().mockReturnValue({
      messages: [{ externalMessageId: 'm1' }],
      statuses: [],
      templateStatusUpdates: [],
    }),
  };
  const registry = {
    hasAdapter: jest.fn().mockReturnValue(true),
    getInbound: jest.fn().mockReturnValue(adapter),
  };
  const channelsService = {
    resolveByLocator: jest
      .fn()
      .mockResolvedValue({ channel: ativo, active: true }),
  };
  const webhookEvents = {
    record: jest.fn().mockResolvedValue('evt1'),
    recordUnrouted: jest.fn().mockResolvedValue('evt2'),
  };
  const inboundQueue = { add: jest.fn().mockResolvedValue({ id: 'j1' }) };
  const templates = { applyStatusUpdate: jest.fn() };
  const errors = { report: jest.fn() };

  // As deps de coexistência/account-update não são exercitadas por estes
  // testes — o foco aqui é o caminho do canal desativado.
  const controller = new WebhookGatewayController(
    registry as any,
    channelsService as any,
    webhookEvents as any,
    inboundQueue as any,
    templates as any,
    undefined as any, // AccountUpdateService
    undefined as any, // CoexistenceHistoryService
    undefined as any, // CoexistenceContactsService
    errors as any,
  );

  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const req: any = {
    headers: {},
    body: { foo: 'bar' },
    rawBody: Buffer.from('{}'),
  };

  const codesReported = () =>
    errors.report.mock.calls.map((c: any[]) => c[0].code);

  return {
    adapter,
    channelsService,
    inboundQueue,
    errors,
    controller,
    req,
    res,
    codesReported,
  };
};

describe('WebhookGatewayController — canal desativado', () => {
  it('reporta CHANNEL_INACTIVE nomeando o canal, e NÃO enfileira', async () => {
    const { channelsService, inboundQueue, errors, controller, req, res } =
      build();
    channelsService.resolveByLocator.mockResolvedValue({
      channel: inativo,
      active: false,
    });

    await controller.handleWebhook('WHATSAPP_OFFICIAL' as any, req, res);

    const reported = errors.report.mock.calls[0][0];
    expect(reported.code).toBe(ERROR_CODES.WEBHOOK_CHANNEL_INACTIVE);
    expect(reported.channelId).toBe('ch2');
    expect(reported.organizationId).toBe('org1');
    // o alerta precisa dizer QUAL canal e o que fazer
    expect(reported.message).toContain('Suporte');
    expect(reported.message).toContain('reative');
    expect(inboundQueue.add).not.toHaveBeenCalled();
  });

  it('não dispara UNROUTED junto — seria mandar investigar config à toa', async () => {
    const { channelsService, controller, req, res, codesReported } = build();
    channelsService.resolveByLocator.mockResolvedValue({
      channel: inativo,
      active: false,
    });

    await controller.handleWebhook('WHATSAPP_OFFICIAL' as any, req, res);

    expect(codesReported()).toEqual([ERROR_CODES.WEBHOOK_CHANNEL_INACTIVE]);
  });

  it('locator desconhecido continua reportando UNROUTED', async () => {
    const { channelsService, controller, req, res, codesReported } = build();
    channelsService.resolveByLocator.mockResolvedValue(null);

    await controller.handleWebhook('WHATSAPP_OFFICIAL' as any, req, res);

    expect(codesReported()).toEqual([ERROR_CODES.WEBHOOK_UNROUTED]);
  });

  it('lote com N locators do mesmo canal inativo alerta UMA vez só', async () => {
    const { adapter, channelsService, controller, req, res, codesReported } =
      build();
    adapter.extractLocators.mockReturnValue([
      { sessionId: 'S2' },
      { sessionId: 'S2' },
      { sessionId: 'S2' },
    ]);
    channelsService.resolveByLocator.mockResolvedValue({
      channel: inativo,
      active: false,
    });

    await controller.handleWebhook('WHATSAPP_OFFICIAL' as any, req, res);

    expect(codesReported()).toEqual([ERROR_CODES.WEBHOOK_CHANNEL_INACTIVE]);
  });

  it('não regride o caminho feliz: canal ativo segue enfileirando', async () => {
    const { inboundQueue, errors, controller, req, res } = build();

    await controller.handleWebhook('WHATSAPP_OFFICIAL' as any, req, res);

    expect(errors.report).not.toHaveBeenCalled();
    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });
});
