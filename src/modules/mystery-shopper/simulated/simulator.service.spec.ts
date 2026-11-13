import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { generateSimulatedPhone, SIMULATOR_MAX_MESSAGES, SimulatorService, toSimulatorStatus } from './simulator.service';

const CHANNEL = { id: 'ch1', type: 'WHATSAPP_OFFICIAL', organizationId: 'org' };
const NUMBER_ROW = { id: 'n1', label: 'Teste', createdAt: new Date(), isSimulated: true, channelId: 'ch1', contact: { phone: '5511987654321' } };

function build(repoOver: Record<string, jest.Mock> = {}) {
  const repository = {
    findOfficialChannels: jest.fn().mockResolvedValue([{ id: 'ch1', name: 'Oficial' }]),
    findActiveOfficialChannel: jest.fn().mockResolvedValue({ id: 'ch1' }),
    createSimulatedNumber: jest.fn().mockResolvedValue(NUMBER_ROW),
    findNumberForSimulator: jest.fn().mockResolvedValue({
      id: 'n1', label: 'Teste', isSimulated: true, profileName: 'Maria', contactId: 'k1',
      contact: { phone: '5511987654321' }, channel: CHANNEL,
    }),
    findSimulatorMessages: jest.fn().mockResolvedValue({ conversationId: null, messages: [] }),
    ...repoOver,
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  return { repository, queue, service: new SimulatorService(repository as never, queue as never) };
}

describe('generateSimulatedPhone', () => {
  it('13 dígitos começando 55259 e o celular começa em 6-9', () => {
    for (let i = 0; i < 200; i++) expect(generateSimulatedPhone()).toMatch(/^55259[6-9]\d{7}$/);
  });
});

describe('toSimulatorStatus', () => {
  it('EMPRESA usa o status em minúsculas', () => {
    expect(toSimulatorStatus({ direction: 'OUTBOUND', status: 'DELIVERED' }, false)).toBe('delivered');
  });
  it('CLIENTE: read se houve resposta depois, senão delivered', () => {
    expect(toSimulatorStatus({ direction: 'INBOUND', status: 'SENT' }, true)).toBe('read');
    expect(toSimulatorStatus({ direction: 'INBOUND', status: 'SENT' }, false)).toBe('delivered');
  });
});

describe('SimulatorService.listChannels', () => {
  it('devolve canais oficiais da org', async () => {
    const { service, repository } = build();
    await expect(service.listChannels('org')).resolves.toEqual([{ id: 'ch1', name: 'Oficial' }]);
    expect(repository.findOfficialChannels).toHaveBeenCalledWith('org');
  });
});

describe('SimulatorService.createNumber', () => {
  const input = { label: ' Teste ', profileName: ' Maria ', channelId: 'ch1' };

  it('cria com número 55259… sem colisão e devolve o item com isSimulated', async () => {
    const { service, repository } = build();
    const row = await service.createNumber('org', input, 'u1');
    const call = repository.createSimulatedNumber.mock.calls[0];
    expect(call[0]).toBe('org');
    expect(call[1]).toMatchObject({ label: 'Teste', profileName: 'Maria', channelId: 'ch1', userId: 'u1' });
    expect(call[1].phone).toMatch(/^55259[6-9]\d{7}$/);
    expect(row).toMatchObject({ id: 'n1', isSimulated: true });
  });

  it('colisão gera outro número', async () => {
    const createSimulatedNumber = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(NUMBER_ROW);
    const { service } = build({ createSimulatedNumber });
    await service.createNumber('org', input, 'u1');
    expect(createSimulatedNumber).toHaveBeenCalledTimes(3);
    const phones = createSimulatedNumber.mock.calls.map((c) => c[1].phone);
    expect(new Set(phones).size).toBe(3);
  });

  it('5 colisões seguidas: 409', async () => {
    const { service, repository } = build({ createSimulatedNumber: jest.fn().mockResolvedValue(null) });
    await expect(service.createNumber('org', input, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createSimulatedNumber).toHaveBeenCalledTimes(5);
  });

  it('canal que não é oficial ativo da org: 400, nada criado', async () => {
    const { service, repository } = build({ findActiveOfficialChannel: jest.fn().mockResolvedValue(null) });
    await expect(service.createNumber('org', input, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createSimulatedNumber).not.toHaveBeenCalled();
  });

  it('nome de perfil vazio vira nulo', async () => {
    const { service, repository } = build();
    await service.createNumber('org', { label: 'x', profileName: '  ', channelId: 'ch1' }, 'u1');
    expect(repository.createSimulatedNumber.mock.calls[0][1].profileName).toBeNull();
  });
});

describe('SimulatorService.sendMessage', () => {
  it('enfileira process-inbound no formato do webhook', async () => {
    const { service, queue } = build();
    const r = await service.sendMessage('org', 'n1', ' oi, tudo bem? ');
    expect(r.queued).toBe(true);
    expect(r.externalMessageId).toMatch(/^sim\.in\.[a-z0-9]+$/);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('process-inbound');
    expect(data).toMatchObject({
      channelId: 'ch1',
      organizationId: 'org',
      message: {
        externalMessageId: r.externalMessageId,
        externalContactId: '5511987654321',
        contactPhone: '5511987654321',
        contactName: 'Maria',
        channelType: 'WHATSAPP_OFFICIAL',
        type: 'TEXT',
        content: { text: 'oi, tudo bem?' },
        rawPayload: { simulated: true },
      },
    });
    expect(data.message.timestamp).toBeInstanceOf(Date);
    expect(opts).toEqual({ attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
  });

  it('número de outra org / inexistente / removido: 404, nada enfileirado', async () => {
    const { service, queue } = build({ findNumberForSimulator: jest.fn().mockResolvedValue(null) });
    await expect(service.sendMessage('org', 'n9', 'oi')).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('número não simulado (chip real): 400, nada enfileirado', async () => {
    const { service, queue } = build({
      findNumberForSimulator: jest.fn().mockResolvedValue({ id: 'n1', isSimulated: false, contact: { phone: '5511999990000' }, channel: null }),
    });
    await expect(service.sendMessage('org', 'n1', 'oi')).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('texto só de espaços: 400', async () => {
    const { service, queue } = build();
    await expect(service.sendMessage('org', 'n1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('SimulatorService.getConversation', () => {
  const at = (n: number) => new Date(Date.UTC(2026, 10, 13, 10, n));

  it('traduz mensagens do ponto de vista do cliente', async () => {
    const rows = [
      { id: 'm1', direction: 'INBOUND', status: 'SENT', content: { text: 'oi' }, createdAt: at(0) },
      { id: 'm2', direction: 'OUTBOUND', status: 'READ', content: { text: '*Ana:* olá' }, createdAt: at(1) },
      { id: 'm3', direction: 'INBOUND', status: 'SENT', content: { text: 'preço?' }, createdAt: at(2) },
    ];
    const { service, repository } = build({ findSimulatorMessages: jest.fn().mockResolvedValue({ conversationId: 'cv1', messages: rows }) });
    const r = await service.getConversation('org', 'n1');
    expect(repository.findSimulatorMessages).toHaveBeenCalledWith('k1', 'ch1', SIMULATOR_MAX_MESSAGES);
    expect(r.number).toEqual({ id: 'n1', label: 'Teste', phone: '5511987654321', profileName: 'Maria' });
    expect(r.conversationId).toBe('cv1');
    expect(r.messages).toEqual([
      { id: 'm1', from: 'CLIENTE', text: 'oi', createdAt: at(0), status: 'read' },
      { id: 'm2', from: 'EMPRESA', text: '*Ana:* olá', createdAt: at(1), status: 'read' },
      { id: 'm3', from: 'CLIENTE', text: 'preço?', createdAt: at(2), status: 'delivered' },
    ]);
  });

  it('sem conversa ainda: conversationId nulo e lista vazia', async () => {
    const { service } = build();
    expect(await service.getConversation('org', 'n1')).toMatchObject({ conversationId: null, messages: [] });
  });

  it('404 para número de outra org; 400 para não simulado', async () => {
    const outra = build({ findNumberForSimulator: jest.fn().mockResolvedValue(null) });
    await expect(outra.service.getConversation('org', 'n1')).rejects.toBeInstanceOf(NotFoundException);
    const chip = build({ findNumberForSimulator: jest.fn().mockResolvedValue({ id: 'n1', isSimulated: false, channel: null, contact: {} }) });
    await expect(chip.service.getConversation('org', 'n1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('número simulado e utilitários de telefone', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { normalizePhone, phoneVariants } = require('../../../common/utils/phone.util');
  it('normalizePhone preserva e phoneVariants gera a variante sem o 9', () => {
    const phone = generateSimulatedPhone();
    expect(phone).toHaveLength(13);
    expect(phone.startsWith('55259')).toBe(true);
    expect(normalizePhone(phone)).toBe(phone);
    const variants = phoneVariants(phone);
    expect(variants).toContain(phone);
    expect(variants).toContain(`5525${phone.slice(5)}`);
  });
});
