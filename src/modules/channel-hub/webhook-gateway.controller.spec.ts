import { WebhookGatewayController } from './webhook-gateway.controller';
import { InboundDropReason } from './inbound-drop-reporter.service';

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
    resolveByLocator: jest.fn().mockResolvedValue({ channel: ativo, active: true }),
  };
  const webhookEvents = { record: jest.fn().mockResolvedValue('evt1') };
  const dropReporter = { reportDrop: jest.fn().mockResolvedValue(undefined) };
  const inboundQueue = { add: jest.fn().mockResolvedValue({ id: 'j1' }) };
  const templates = { applyStatusUpdate: jest.fn() };

  // As deps de coexistência/account-update não são exercitadas por estes
  // testes — o que importa aqui são os 4 caminhos de descarte.
  const controller = new WebhookGatewayController(
    registry as any,
    channelsService as any,
    webhookEvents as any,
    inboundQueue as any,
    templates as any,
    undefined as any,       // AccountUpdateService
    undefined as any,       // CoexistenceHistoryService
    undefined as any,       // CoexistenceContactsService
    dropReporter as any,
  );

  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const req: any = { headers: {}, body: { foo: 'bar' }, rawBody: Buffer.from('{}') };

  return { adapter, registry, channelsService, webhookEvents, dropReporter, inboundQueue, controller, req, res };
};

describe('WebhookGatewayController — fail loud', () => {
  it('relata NO_LOCATORS quando o payload não tem locator', async () => {
    const { adapter, dropReporter, controller, req, res } = build();
    adapter.extractLocators.mockReturnValue([]);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop).toHaveBeenCalledTimes(1);
    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.NO_LOCATORS,
      channel: null,
    });
    expect(res.json).toHaveBeenCalledWith({ status: 'no_locators' });
  });

  it('relata UNKNOWN_LOCATOR quando nenhum canal casa', async () => {
    const { channelsService, dropReporter, controller, req, res } = build();
    channelsService.resolveByLocator.mockResolvedValue(null);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.UNKNOWN_LOCATOR,
      channel: null,
    });
    expect(res.json).toHaveBeenCalledWith({ status: 'no_matching_channel' });
  });

  it('relata CHANNEL_INACTIVE e NÃO enfileira quando o canal está desativado', async () => {
    const { channelsService, dropReporter, inboundQueue, controller, req, res } = build();
    channelsService.resolveByLocator.mockResolvedValue({ channel: inativo, active: false });

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.CHANNEL_INACTIVE,
      channel: inativo,
    });
    expect(inboundQueue.add).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'no_matching_channel' });
  });

  it('relata INVALID_SIGNATURE e não enfileira quando a assinatura é inválida', async () => {
    const { adapter, dropReporter, inboundQueue, controller, req, res } = build();
    adapter.validateWebhook.mockReturnValue(false);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.INVALID_SIGNATURE,
      channel: ativo,
    });
    expect(inboundQueue.add).not.toHaveBeenCalled();
  });

  it('não regride o caminho feliz: canal ativo segue enfileirando', async () => {
    const { dropReporter, inboundQueue, controller, req, res } = build();

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    expect(dropReporter.reportDrop).not.toHaveBeenCalled();
    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('payload com vários locators: um ruim não impede o bom de ser processado', async () => {
    const { adapter, channelsService, dropReporter, inboundQueue, controller, req, res } = build();
    // locator ruim PRIMEIRO: assim um `break`/`return` prematuro impediria o
    // bom de ser processado, e o teste pega.
    adapter.extractLocators.mockReturnValue([{ sessionId: 'S9' }, { sessionId: 'S1' }]);
    channelsService.resolveByLocator
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ channel: ativo, active: true });

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    // o locator desconhecido é relatado...
    expect(dropReporter.reportDrop).toHaveBeenCalledTimes(1);
    expect(dropReporter.reportDrop.mock.calls[0][0]).toMatchObject({
      reason: InboundDropReason.UNKNOWN_LOCATOR,
    });
    // ...e o canal válido segue sendo processado normalmente
    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('lote com N locators ruins do mesmo motivo gera 1 relato agregado, não N', async () => {
    const { adapter, channelsService, dropReporter, controller, req, res } = build();
    adapter.extractLocators.mockReturnValue([
      { sessionId: 'A' },
      { sessionId: 'B' },
      { sessionId: 'C' },
    ]);
    channelsService.resolveByLocator.mockResolvedValue(null);

    await controller.handleWebhook('WHATSAPP_WASENDER' as any, req, res);

    // 3 locators desconhecidos, mesmo motivo+canal(null) → 1 único reportDrop
    expect(dropReporter.reportDrop).toHaveBeenCalledTimes(1);
    const arg = dropReporter.reportDrop.mock.calls[0][0];
    expect(arg.reason).toBe(InboundDropReason.UNKNOWN_LOCATOR);
    expect(arg.detail).toContain('3x');
    expect(arg.detail).toContain('sessionId');
  });
});
