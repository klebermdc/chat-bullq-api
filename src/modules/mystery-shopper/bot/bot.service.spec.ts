import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BOT_OPENING_MESSAGE, botTurnJobId } from './bot.constants';
import { BotService } from './bot.service';

const PERSONA = 'Maria, 34 anos, quer ir a Orlando em julho com o marido e 2 filhos.';
const NUMBER = { id: 'n1', isSimulated: true, contactId: 'k1', contact: { phone: '5525912345678' }, channel: { id: 'ch1', type: 'WHATSAPP_OFFICIAL' } };
const RUN = {
  id: 'r1', status: 'ACTIVE', persona: PERSONA, clientMessages: 1, lastError: null,
};

function build(over: { number?: unknown; active?: unknown; latest?: unknown; job?: unknown } = {}) {
  const numbers = { findNumberForSimulator: jest.fn().mockResolvedValue('number' in over ? over.number : NUMBER) };
  const repo = {
    findActiveRun: jest.fn().mockResolvedValue('active' in over ? over.active : null),
    createRunExclusive: jest.fn().mockResolvedValue(RUN),
    stopRun: jest.fn().mockResolvedValue({ ...RUN, status: 'STOPPED' }),
    failRun: jest.fn().mockResolvedValue(undefined),
    findLatestRun: jest.fn().mockResolvedValue('latest' in over ? over.latest : null),
  };
  const simulator = { sendMessage: jest.fn().mockResolvedValue({ queued: true, externalMessageId: 'sim.in.x' }) };
  const job = 'job' in over ? over.job : { remove: jest.fn().mockResolvedValue(undefined) };
  const queue = { getJob: jest.fn().mockResolvedValue(job) };
  const service = new BotService(numbers as never, repo as never, simulator as never, queue as never);
  return { service, numbers, repo, simulator, queue, job };
}

describe('BotService.start', () => {
  it('envia exatamente a mensagem de abertura fixa pelo simulador', async () => {
    const { service, simulator, repo } = build();
    const state = await service.start('org', 'n1', PERSONA);
    expect(BOT_OPENING_MESSAGE).toBe('Olá! Vi esse anúncio e quero solicitar uma cotação.');
    expect(simulator.sendMessage).toHaveBeenCalledWith('org', 'n1', 'Olá! Vi esse anúncio e quero solicitar uma cotação.');
    expect(repo.createRunExclusive).toHaveBeenCalledWith('org', 'n1', PERSONA);
    expect(state).toEqual({ status: 'ACTIVE', persona: PERSONA, clientMessages: 1, lastError: null });
  });

  it('número de outra org ou inexistente = 404, sem enviar', async () => {
    const { service, simulator } = build({ number: null });
    await expect(service.start('org', 'n1', PERSONA)).rejects.toBeInstanceOf(NotFoundException);
    expect(simulator.sendMessage).not.toHaveBeenCalled();
  });

  it('número que não é simulado = 400, sem enviar', async () => {
    const { service, simulator, repo } = build({ number: { ...NUMBER, isSimulated: false } });
    await expect(service.start('org', 'n1', PERSONA)).rejects.toBeInstanceOf(BadRequestException);
    expect(simulator.sendMessage).not.toHaveBeenCalled();
    expect(repo.createRunExclusive).not.toHaveBeenCalled();
  });

  it('já com robô ativo = 409, sem enviar', async () => {
    const { service, simulator, repo } = build();
    repo.createRunExclusive.mockResolvedValue(null);
    await expect(service.start('org', 'n1', PERSONA)).rejects.toBeInstanceOf(ConflictException);
    expect(simulator.sendMessage).not.toHaveBeenCalled();
  });

  it('se o envio da abertura falha, marca a execução FAILED e repassa o erro', async () => {
    const { service, simulator, repo } = build();
    simulator.sendMessage.mockRejectedValue(new Error('fila fora'));
    await expect(service.start('org', 'n1', PERSONA)).rejects.toThrow('fila fora');
    expect(repo.failRun).toHaveBeenCalledWith('r1', 'fila fora');
  });
});

describe('BotService.stop', () => {
  it('passa ACTIVE/CLOSING para STOPPED e remove o job pendente', async () => {
    const { service, repo, queue, job } = build({ active: RUN });
    const state = await service.stop('org', 'n1');
    expect(repo.stopRun).toHaveBeenCalledWith('r1');
    expect(queue.getJob).toHaveBeenCalledWith(botTurnJobId('r1'));
    expect((job as { remove: jest.Mock }).remove).toHaveBeenCalled();
    expect(state?.status).toBe('STOPPED');
  });

  it('sem robô ativo devolve o estado atual sem erro', async () => {
    const { service, repo } = build({ active: null, latest: { ...RUN, status: 'ENDED' } });
    expect((await service.stop('org', 'n1'))?.status).toBe('ENDED');
    expect(repo.stopRun).not.toHaveBeenCalled();
  });

  it('job que não pode ser removido (em execução) não impede a parada', async () => {
    const { service, job } = build({ active: RUN, job: { remove: jest.fn().mockRejectedValue(new Error('locked')) } });
    await expect(service.stop('org', 'n1')).resolves.toMatchObject({ status: 'STOPPED' });
    expect((job as { remove: jest.Mock }).remove).toHaveBeenCalled();
  });

  it('número de outra org = 404', async () => {
    const { service } = build({ number: null });
    await expect(service.stop('org', 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BotService.getState', () => {
  it('devolve a execução mais recente no formato público', async () => {
    const { service, repo } = build({ latest: { ...RUN, status: 'FAILED', lastError: 'ilegível' } });
    await expect(service.getState('org', 'n1')).resolves.toEqual({
      status: 'FAILED', persona: PERSONA, clientMessages: 1, lastError: 'ilegível',
    });
    expect(repo.findLatestRun).toHaveBeenCalledWith('org', 'n1');
  });

  it('sem execução = null', async () => {
    const { service } = build();
    await expect(service.getState('org', 'n1')).resolves.toBeNull();
  });
});
