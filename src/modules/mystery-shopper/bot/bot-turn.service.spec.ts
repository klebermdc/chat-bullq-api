import { BotTurnService } from './bot-turn.service';

const NOW = new Date('2026-11-13T15:00:00Z'); // 12:00 em São Paulo
const NIGHT = new Date('2026-11-13T04:00:00Z'); // 01:00 em São Paulo
const NUMBER = { id: 'n1', isSimulated: true, contactId: 'k1', contact: { phone: '5525912345678' }, channel: { id: 'ch1', type: 'WHATSAPP_OFFICIAL' } };
const RUN_AT = new Date('2026-11-13T10:00:00Z');
const RUN = { createdAt: RUN_AT, id: 'r1', organizationId: 'org', numberId: 'n1', persona: 'Maria quer Orlando', status: 'ACTIVE', clientMessages: 2, followUpAnswered: false, lastError: null };
const CONVERSATION = {
  messages: [
    { id: 'm1', createdAt: new Date('2026-11-13T10:00:01Z'), from: 'CLIENTE', text: 'Olá! Vi esse anúncio e quero solicitar uma cotação.' },
    { id: 'm2', createdAt: new Date('2026-11-13T10:05:00Z'), from: 'EMPRESA', text: 'Oi Maria! Quantas pessoas vão viajar?' },
  ],
};
const answer = (obj: unknown) => ({ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) }, usage: { costUsd: 0.01 } });

function build(over: { run?: unknown; conversation?: unknown; simulated?: boolean; number?: unknown } = {}) {
  const repo = {
    findRun: jest.fn().mockResolvedValue('run' in over ? over.run : RUN),
    findTimezone: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    recordTurn: jest.fn().mockResolvedValue(undefined),
    addCost: jest.fn().mockResolvedValue(undefined),
    failRun: jest.fn().mockResolvedValue(undefined),
  };
  const numbers = { findNumberForSimulator: jest.fn().mockResolvedValue('number' in over ? over.number : NUMBER) };
  const simulator = {
    getConversation: jest.fn().mockResolvedValue(over.conversation ?? CONVERSATION),
    sendMessage: jest.fn().mockResolvedValue({ queued: true }),
  };
  const recipients = { isSimulatedContact: jest.fn().mockResolvedValue(over.simulated ?? true) };
  const llm = { complete: jest.fn().mockResolvedValue(answer({ acao: 'responder', mensagem: 'somos em 4' })) };
  const service = new BotTurnService(repo as never, numbers as never, simulator as never, recipients as never, llm as never);
  return { service, repo, numbers, simulator, recipients, llm };
}

describe('BotTurnService.run', () => {
  it('responder: envia pelo simulador e incrementa', async () => {
    const { service, simulator, repo, llm } = build();
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SENT' });
    expect(simulator.sendMessage).toHaveBeenCalledWith('org', 'n1', 'somos em 4');
    expect(repo.recordTurn).toHaveBeenCalledWith('r1', { status: 'ACTIVE', sent: true, followUpAnswered: false, costUsd: 0.01 });
    expect(llm.complete).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', temperature: 0.7, maxTokens: 600 }));
  });

  it('encerrar: envia a saída e vai para CLOSING', async () => {
    const { service, simulator, repo, llm } = build();
    llm.complete.mockResolvedValue(answer({ acao: 'encerrar', mensagem: 'vou ver com meu marido e te falo' }));
    await service.run('r1', NOW);
    expect(simulator.sendMessage).toHaveBeenCalledWith('org', 'n1', 'vou ver com meu marido e te falo');
    expect(repo.recordTurn).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'CLOSING', sent: true }));
  });

  it('CLOSING + follow-up: 1 resposta e depois ENDED', async () => {
    const { service, repo, simulator } = build({ run: { ...RUN, status: 'CLOSING', clientMessages: 8 } });
    await service.run('r1', NOW);
    expect(simulator.sendMessage).toHaveBeenCalledTimes(1);
    expect(repo.recordTurn).toHaveBeenCalledWith('r1', { status: 'ENDED', sent: true, followUpAnswered: true, costUsd: 0.01 });
  });

  it('CLOSING que já respondeu o follow-up não faz nada', async () => {
    const { service, llm, simulator } = build({ run: { ...RUN, status: 'CLOSING', followUpAnswered: true } });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SKIPPED' });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(simulator.sendMessage).not.toHaveBeenCalled();
  });

  it('limite de 15 mensagens força encerrar mesmo se a IA quiser continuar', async () => {
    const { service, repo, llm } = build({ run: { ...RUN, clientMessages: 15 } });
    await service.run('r1', NOW);
    expect(llm.complete.mock.calls[0][0].messages[1].content).toContain('ENCERRAR AGORA: sim');
    expect(repo.recordTurn).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'CLOSING', sent: true }));
  });

  it('silencio não envia nem conta mensagem, mas registra o custo', async () => {
    const { service, repo, simulator, llm } = build();
    llm.complete.mockResolvedValue(answer({ acao: 'silencio' }));
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SILENT' });
    expect(simulator.sendMessage).not.toHaveBeenCalled();
    expect(repo.recordTurn).toHaveBeenCalledWith('r1', { status: 'ACTIVE', sent: false, followUpAnswered: false, costUsd: 0.01 });
  });

  it('fora do horário reagenda para 08:00 + jitter sem chamar a IA', async () => {
    const { service, llm, simulator } = build();
    const outcome = await service.run('r1', NIGHT);
    expect(outcome.kind).toBe('DELAYED');
    const delay = (outcome as { delayMs: number }).delayMs;
    expect(delay).toBeGreaterThanOrEqual(7 * 3_600_000);
    expect(delay).toBeLessThan(7 * 3_600_000 + 30 * 60_000);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(simulator.sendMessage).not.toHaveBeenCalled();
  });

  it('ilegível 2x = FAILED, nada enviado', async () => {
    const { service, llm, simulator, repo } = build();
    llm.complete.mockResolvedValue(answer('não sei responder isso'));
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'FAILED' });
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(simulator.sendMessage).not.toHaveBeenCalled();
    expect(repo.failRun).toHaveBeenCalledWith('r1', expect.stringContaining('ilegível'), 0.02);
  });

  it('texto com caractere estrangeiro nunca é enviado (2 tentativas)', async () => {
    const { service, llm, simulator, repo } = build();
    llm.complete.mockResolvedValue(answer({ acao: 'responder', mensagem: 'somos 四 pessoas' }));
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'FAILED' });
    expect(simulator.sendMessage).not.toHaveBeenCalled();
    expect(repo.failRun).toHaveBeenCalled();
  });

  it('estrangeiro na 1ª e limpo na 2ª: envia a 2ª', async () => {
    const { service, llm, simulator } = build();
    llm.complete
      .mockResolvedValueOnce(answer({ acao: 'responder', mensagem: 'привет' }))
      .mockResolvedValueOnce(answer({ acao: 'responder', mensagem: 'somos em 4' }));
    await service.run('r1', NOW);
    expect(simulator.sendMessage).toHaveBeenCalledWith('org', 'n1', 'somos em 4');
    expect(llm.complete.mock.calls[1][0].messages[1].content).toMatch(/ilegível|outro idioma/);
  });

  it('erro da IA conta como tentativa e depois FAILED', async () => {
    const { service, llm, repo } = build();
    llm.complete.mockRejectedValue(new Error('timeout'));
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'FAILED' });
    expect(repo.failRun).toHaveBeenCalledWith('r1', expect.any(String), 0);
  });

  it('execução parada/encerrada = SKIPPED sem IA', async () => {
    for (const status of ['STOPPED', 'ENDED', 'FAILED']) {
      const { service, llm } = build({ run: { ...RUN, status } });
      await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SKIPPED' });
      expect(llm.complete).not.toHaveBeenCalled();
    }
    const { service } = build({ run: null });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SKIPPED' });
  });

  it('se a última mensagem já é do cliente (nada novo da equipe) = SKIPPED', async () => {
    const { service, llm } = build({ conversation: { messages: [...CONVERSATION.messages, { id: 'm3', createdAt: new Date('2026-11-13T10:06:00Z'), from: 'CLIENTE', text: 'somos em 4' }] } });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SKIPPED' });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('parado durante a chamada da IA: não envia, mas o custo é registrado', async () => {
    const { service, repo, simulator } = build();
    repo.findRun.mockResolvedValueOnce(RUN).mockResolvedValueOnce({ ...RUN, status: 'STOPPED' });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SKIPPED' });
    expect(simulator.sendMessage).not.toHaveBeenCalled();
    expect(repo.addCost).toHaveBeenCalledWith('r1', 0.01);
  });

  it('execução nova só alimenta a IA com mensagens criadas a partir dela', async () => {
    const old = { id: 'old', createdAt: new Date('2026-11-12T09:00:00Z'), from: 'EMPRESA', text: 'conversa antiga do outro teste' };
    const { service, llm } = build({ conversation: { messages: [old, ...CONVERSATION.messages] } });
    await service.run('r1', NOW);
    const user = llm.complete.mock.calls[0][0].messages[1].content as string;
    expect(user).not.toContain('conversa antiga');
    expect(user).toContain('Quantas pessoas vão viajar?');
  });

  it('só histórico antigo (nada desta execução) = SKIPPED sem IA', async () => {
    const old = { id: 'old', createdAt: new Date('2026-11-12T09:00:00Z'), from: 'EMPRESA', text: 'antiga' };
    const { service, llm } = build({ conversation: { messages: [old] } });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SKIPPED' });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('erro depois da IA (ex.: envio) marca FAILED com o custo e repassa o erro', async () => {
    const { service, repo, simulator } = build();
    simulator.sendMessage.mockRejectedValue(new Error('fila fora'));
    await expect(service.run('r1', NOW)).rejects.toThrow('fila fora');
    expect(repo.failRun).toHaveBeenCalledWith('r1', 'fila fora', 0.01);
  });

  it('markFailed registra a falha sem custo', async () => {
    const { service, repo } = build();
    await service.markFailed('r1', 'boom');
    expect(repo.failRun).toHaveBeenCalledWith('r1', 'boom', 0);
  });

  it('contato que não é simulado: FAILED e nada enviado', async () => {
    const { service, simulator, repo, llm } = build({ simulated: false });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'FAILED' });
    expect(simulator.sendMessage).not.toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();
    expect(repo.failRun).toHaveBeenCalledWith('r1', expect.stringContaining('simulado'), 0);
  });

  it('número removido: FAILED', async () => {
    const { service, repo } = build({ number: null });
    await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'FAILED' });
    expect(repo.failRun).toHaveBeenCalled();
  });

  it('envia só as últimas 60 mensagens para a IA', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, createdAt: new Date('2026-11-13T10:10:00Z'), from: i % 2 ? 'EMPRESA' : 'CLIENTE', text: `msg-${i}` }));
    const { service, llm } = build({ conversation: { messages: many } });
    await service.run('r1', NOW);
    const user = llm.complete.mock.calls[0][0].messages[1].content as string;
    expect(user).toContain('msg-99');
    expect(user).toContain('msg-40');
    expect(user).not.toMatch(/msg-39(\n|$)/);
  });

  describe('mensagem da equipe durante o turno', () => {
    const NEW_TEAM = { createdAt: new Date('2026-11-13T10:07:00Z'), id: 'm3', from: 'EMPRESA', text: 'Posso mandar a cotação?' };

    it('agenda novo turno (mesmo job, 40–90 s) se a equipe escreveu durante a chamada da IA', async () => {
      const { service, simulator } = build();
      simulator.getConversation
        .mockResolvedValueOnce(CONVERSATION)
        .mockResolvedValueOnce({ messages: [...CONVERSATION.messages, { id: 'm-bot', createdAt: new Date('2026-11-13T10:06:00Z'), from: 'CLIENTE', text: 'somos em 4' }, NEW_TEAM] });
      const outcome = await service.run('r1', NOW);
      expect(simulator.sendMessage).toHaveBeenCalledTimes(1);
      expect(outcome.kind).toBe('DELAYED');
      const delay = (outcome as { delayMs: number }).delayMs;
      expect(delay).toBeGreaterThanOrEqual(40_000);
      expect(delay).toBeLessThanOrEqual(90_000);
    });

    it('também após silencio', async () => {
      const { service, simulator, llm } = build();
      llm.complete.mockResolvedValue(answer({ acao: 'silencio' }));
      simulator.getConversation
        .mockResolvedValueOnce(CONVERSATION)
        .mockResolvedValueOnce({ messages: [...CONVERSATION.messages, NEW_TEAM] });
      expect((await service.run('r1', NOW)).kind).toBe('DELAYED');
    });

    it('sem mensagem nova da equipe não agenda nada', async () => {
      const { service, simulator } = build();
      simulator.getConversation
        .mockResolvedValueOnce(CONVERSATION)
        .mockResolvedValueOnce({ messages: [...CONVERSATION.messages, { id: 'm-bot', createdAt: new Date('2026-11-13T10:06:00Z'), from: 'CLIENTE', text: 'somos em 4' }] });
      await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SENT' });
    });

    it('execução parada ou encerrada neste turno não agenda', async () => {
      const { service, simulator, repo } = build();
      simulator.getConversation
        .mockResolvedValueOnce(CONVERSATION)
        .mockResolvedValueOnce({ messages: [...CONVERSATION.messages, NEW_TEAM] });
      repo.findRun.mockResolvedValueOnce(RUN).mockResolvedValueOnce(RUN).mockResolvedValueOnce({ ...RUN, status: 'ENDED' });
      await expect(service.run('r1', NOW)).resolves.toEqual({ kind: 'SENT' });
    });
  });
});
