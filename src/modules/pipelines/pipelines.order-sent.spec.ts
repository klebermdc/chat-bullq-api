import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';

/**
 * E6 — Entrega: ao clicar "Pedido enviado", o card da conversa move pra etapa
 * final do funil. Diferente de `ensureConversationAtStageByName`, a entrega
 * acontece DEPOIS do fechamento (card já ganho/WON) — então NÃO pode ter a
 * guarda "só mexe em OPEN". Por decisão de projeto, E6 é só ETAPA (sem tag
 * redundante "ingressos enviados").
 */
function make(overrides: {
  stage?: unknown;
  card?: unknown;
} = {}) {
  const prisma = {
    pipelineStage: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.stage === undefined
          ? { id: 'stage-final', pipelineId: 'pipe-1' }
          : overrides.stage,
      ),
    },
    card: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.card === undefined
          ? { id: 'card-1', pipelineId: 'pipe-1', status: 'WON' }
          : overrides.card,
      ),
    },
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const cadenceRunner = { maybeStartForStage: jest.fn() } as any;
  const metaCapiQueue = { enqueuePurchase: jest.fn() } as any;
  // Task 10: novas deps injetadas — geração do aceite + envio do link no WhatsApp.
  const acceptances = { createForConversation: jest.fn() } as any;
  const messages = { send: jest.fn() } as any;
  const service = new PipelinesService(
    prisma,
    realtime,
    cadenceRunner,
    metaCapiQueue,
    acceptances,
    messages,
  );
  // moveCard é testado noutro lugar — aqui espiamos que E6 o chama certo.
  const moveSpy = jest
    .spyOn(service, 'moveCard')
    .mockResolvedValue({ id: 'card-1' } as any);
  return { service, prisma, moveSpy, acceptances, messages };
}

describe('PipelinesService.markOrderSentForConversation (E6)', () => {
  it('move o card da conversa pra etapa final — mesmo com card já ganho (WON)', async () => {
    const { service, prisma, moveSpy } = make();
    await service.markOrderSentForConversation('org-1', 'conv-1');

    expect(prisma.pipelineStage.findFirst).toHaveBeenCalled();
    expect(moveSpy).toHaveBeenCalledWith(
      'card-1',
      'org-1',
      expect.objectContaining({ toStageId: 'stage-final' }),
    );
  });

  it('lança se a etapa final não existe no funil', async () => {
    const { service, moveSpy } = make({ stage: null });
    await expect(
      service.markOrderSentForConversation('org-1', 'conv-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('lança se a conversa não tem card no funil', async () => {
    const { service, moveSpy } = make({ card: null });
    await expect(
      service.markOrderSentForConversation('org-1', 'conv-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('com withAcceptance cria aceite, envia link no WhatsApp e ainda move o card', async () => {
    const { service, moveSpy, acceptances, messages } = make();
    const created = { acceptance: { id: 'acc-1' }, link: 'https://x.test/aceite/tok' };
    acceptances.createForConversation.mockResolvedValue(created);
    messages.send.mockResolvedValue({ id: 'm1' });
    const res = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'Ingresso' }],
      createdById: 'user-1',
    });
    expect(moveSpy).toHaveBeenCalled();
    expect(acceptances.createForConversation).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      expect.objectContaining({
        items: [{ description: 'Ingresso' }],
        createdById: 'user-1',
      }),
    );
    expect(messages.send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        type: 'TEXT',
        content: expect.objectContaining({
          text: expect.stringContaining('https://x.test/aceite/tok'),
        }),
      }),
      'user-1',
      'org-1',
      'ALL',
      undefined,
      expect.objectContaining({ system: true, automated: true }),
    );
    expect(res.acceptanceLink).toBe('https://x.test/aceite/tok');
  });

  it('withAcceptance=false mantém o legado: só move o card, sem aceite', async () => {
    const { service, acceptances } = make();
    const res = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: false,
    });
    expect(acceptances.createForConversation).not.toHaveBeenCalled();
    expect(res.acceptanceLink).toBeUndefined();
  });

  it('envia cada voucher como DOCUMENT antes da mensagem do link', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });

    await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'Magic Kingdom' }],
      createdById: 'u1',
      vouchers: [
        { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v1.pdf', size: 10 },
      ],
    });

    const types = messages.send.mock.calls.map((c: any[]) => c[0].type);
    expect(types).toEqual(['DOCUMENT', 'TEXT']);
    // `fileName` (camelCase) é a chave que os adapters leem pra montar o
    // `document.filename` do provedor — com `filename` o PDF chegaria sem nome.
    expect(messages.send.mock.calls[0][0].content).toMatchObject({
      mediaUrl: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf',
      mimeType: 'application/pdf',
      fileSize: 10,
      fileName: 'v1.pdf',
    });
  });

  it('repassa vouchers e orderRef pro aceite', async () => {
    const { service, acceptances } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    const vouchers = [
      { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v1.pdf', size: 10 },
    ];

    await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'Magic Kingdom' }],
      createdById: 'u1',
      vouchers,
      orderRef: 'OFP-123',
    });

    expect(acceptances.createForConversation).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      expect.objectContaining({ vouchers, orderRef: 'OFP-123' }),
    );
  });

  it('devolve o messageId de cada voucher enfileirado', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockResolvedValue({ id: 'msg-1' });

    const out = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [{ url: 'https://api.x/a.pdf', filename: 'v1.pdf', size: 10 }],
    });

    // `queued`, não `sent`: o send só enfileira. Quem diz se chegou é a Message
    // — e é o messageId que permite ir olhar o status dela depois.
    expect(out.voucherResults).toEqual([
      { filename: 'v1.pdf', queued: true, messageId: 'msg-1' },
    ]);
    expect(out.linkResult).toEqual({ queued: true, messageId: 'msg-1' });
  });

  it('cria o aceite e reporta a falha quando o envio de um voucher falha', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    // Falha SÍNCRONA do send — as que existem de verdade são de nível de
    // conversa (conversa ou canal do contato inexistente). Janela 24h fechada
    // NÃO aparece aqui: aquilo roda no worker, depois que o send já resolveu.
    messages.send.mockImplementation((dto: any) => {
      if (dto.type === 'DOCUMENT') throw new NotFoundException('Contact channel not found');
      return { id: 'm1' };
    });

    const out = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [
        { url: 'https://api.x/api/v1/uploads/media/2026-08-06/a.pdf', filename: 'v1.pdf', size: 10 },
      ],
    });

    expect(acceptances.createForConversation).toHaveBeenCalled();
    expect(out.acceptanceLink).toBe('https://sendtur.com.br/aceite/tok');
    expect(out.voucherResults).toEqual([
      {
        filename: 'v1.pdf',
        queued: false,
        error: 'Conversa ou canal do cliente não encontrado.',
      },
    ]);
    // O link ainda foi enviado: um PDF que não passou não cancela a conferência.
    expect(messages.send.mock.calls.map((c: any[]) => c[0].type)).toEqual([
      'DOCUMENT',
      'TEXT',
    ]);
  });

  it('não vaza o texto cru da exceção pro cliente', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockImplementation((dto: any) => {
      if (dto.type === 'DOCUMENT') {
        throw new Error('connect ECONNREFUSED 10.0.0.7:6379 (redis-interno)');
      }
      return { id: 'm1' };
    });

    const out = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [{ url: 'https://api.x/a.pdf', filename: 'v1.pdf', size: 10 }],
    });

    expect(out.voucherResults?.[0].error).toBe('Não foi possível enviar agora.');
    expect(JSON.stringify(out.voucherResults)).not.toMatch(/ECONNREFUSED|10\.0\.0\.7/);
  });

  it('um voucher que falha não impede os seguintes', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockImplementation((dto: any) => {
      if (dto.content?.fileName === 'v1.pdf') throw new NotFoundException('sumiu');
      return { id: 'm1' };
    });

    const out = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [
        { url: 'https://api.x/a.pdf', filename: 'v1.pdf', size: 10 },
        { url: 'https://api.x/b.pdf', filename: 'v2.pdf', size: 20 },
      ],
    });

    expect(out.voucherResults).toEqual([
      {
        filename: 'v1.pdf',
        queued: false,
        error: 'Conversa ou canal do cliente não encontrado.',
      },
      { filename: 'v2.pdf', queued: true, messageId: 'm1' },
    ]);
  });

  it('reporta a falha do link em vez de estourar o request', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    // Falha de nível de conversa derruba TODOS os envios, inclusive o do link.
    // Sem o try/catch no link, o request virava 500 e o atendente perdia o
    // relatório justamente quando ele mais importa.
    messages.send.mockRejectedValue(new NotFoundException('Conversation not found'));

    const out = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [{ url: 'https://api.x/a.pdf', filename: 'v1.pdf', size: 10 }],
    });

    expect(out.acceptanceLink).toBe('https://sendtur.com.br/aceite/tok');
    expect(out.linkResult).toEqual({
      queued: false,
      error: 'Conversa ou canal do cliente não encontrado.',
    });
    expect(out.voucherResults).toEqual([
      {
        filename: 'v1.pdf',
        queued: false,
        error: 'Conversa ou canal do cliente não encontrado.',
      },
    ]);
  });

  it('não envia NADA se a criação do aceite falha', async () => {
    const { service, acceptances, messages } = make();
    // APP_PUBLIC_URL ausente estoura na primeira linha do createForConversation:
    // é justamente por isso que ele roda antes de qualquer envio. Voucher na mão
    // do cliente sem aceite por trás é irrecuperável.
    acceptances.createForConversation.mockRejectedValue(
      new Error('APP_PUBLIC_URL não configurado'),
    );

    await expect(
      service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
        withAcceptance: true,
        items: [{ description: 'X' }],
        createdById: 'u1',
        vouchers: [
          { url: 'https://api.x/a.pdf', filename: 'v1.pdf', size: 10 },
        ],
      }),
    ).rejects.toThrow('APP_PUBLIC_URL não configurado');

    expect(messages.send).not.toHaveBeenCalled();
  });

  it('não deixa o nome do arquivo forjar linha de log', async () => {
    const { service, acceptances, messages } = make();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockImplementation((dto: any) => {
      if (dto.type === 'DOCUMENT') throw new Error('falhou');
      return { id: 'm1' };
    });

    await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'X' }],
      createdById: 'u1',
      vouchers: [
        { url: 'https://api.x/a.pdf', filename: 'v.pdf\n[Nest] LOG forjado', size: 10 },
      ],
    });

    const logged = warn.mock.calls.map((c) => String(c[0])).join('');
    expect(logged).not.toMatch(/[\n\r]/);
    warn.mockRestore();
  });

  it('continua movendo o card quando withAcceptance é false', async () => {
    const { service, acceptances, messages } = make();

    await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: false,
    });

    expect(acceptances.createForConversation).not.toHaveBeenCalled();
    expect(messages.send).not.toHaveBeenCalled();
  });
});
