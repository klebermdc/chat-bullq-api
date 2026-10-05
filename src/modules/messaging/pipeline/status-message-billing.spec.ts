import { InboundMessageProcessor } from './inbound-message.processor';

/**
 * Registro de cobrança por mensagem dentro do `processStatus`. Instanciado sem
 * o container do Nest (mesmo motivo do meta-window-expiry.spec): o trecho só
 * toca `prisma.message`, `channelUsage` e `logger`.
 */
function makeProcessor(recordMessageBilling: jest.Mock) {
  const warn = jest.fn();
  const findFirst = jest.fn(async () => null); // mensagem ainda não casada
  const proc: any = Object.create(InboundMessageProcessor.prototype);
  proc.prisma = { message: { findFirst } };
  proc.logger = { warn };
  proc.channelUsage = { recordMessageBilling, recordWindow: jest.fn() };
  return { proc, warn, findFirst };
}

const PRICING = {
  billable: false,
  category: 'service',
  pricingModel: 'PMP',
  type: 'free_customer_service',
};

function job(overrides: Record<string, any> = {}) {
  return {
    channelId: 'chan1',
    organizationId: 'org1',
    status: {
      externalMessageId: 'wamid.A',
      status: 'sent',
      timestamp: new Date('2026-10-02T14:00:00Z'),
      pricing: PRICING,
    },
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('processStatus → cobrança por mensagem', () => {
  it('registra a cobrança quando o status traz pricing', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const { proc } = makeProcessor(record);
    const data = job();

    await proc.processStatus(data);

    expect(record).toHaveBeenCalledWith('org1', 'chan1', data.status);
  });

  it('registra mesmo quando a mensagem ainda não foi casada pelo wamid', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const { proc, findFirst } = makeProcessor(record);

    await proc.processStatus(job());

    expect(findFirst).toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('não registra status sem pricing', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const { proc } = makeProcessor(record);
    const data = job();

    await proc.processStatus({
      ...data,
      status: { ...data.status, pricing: undefined },
    });

    expect(record).not.toHaveBeenCalled();
  });

  it('não registra sem organização no job', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const { proc } = makeProcessor(record);

    await proc.processStatus(job({ organizationId: undefined }));

    expect(record).not.toHaveBeenCalled();
  });

  it('falha ao gravar a cobrança não derruba o status: só loga', async () => {
    const record = jest.fn().mockRejectedValue(new Error('pool exhausted'));
    const { proc, warn } = makeProcessor(record);

    await expect(proc.processStatus(job())).resolves.toBeUndefined();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('recordMessageBilling falhou'),
    );
  });

  it('erro síncrono no registro também é engolido', async () => {
    const record = jest.fn(() => {
      throw new Error('boom');
    });
    const { proc, warn } = makeProcessor(record);

    await expect(proc.processStatus(job())).resolves.toBeUndefined();
    await flush();

    expect(warn).toHaveBeenCalled();
  });
});
