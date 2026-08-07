import { BadRequestException, Logger } from '@nestjs/common';
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

  it('cria o aceite e reporta a falha quando o envio de um voucher falha', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockImplementation((dto: any) => {
      if (dto.type === 'DOCUMENT') throw new Error('janela de 24h fechada');
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
      { filename: 'v1.pdf', sent: false, error: 'janela de 24h fechada' },
    ]);
    // O link ainda foi enviado: um PDF que não passou não cancela a conferência.
    expect(messages.send.mock.calls.map((c: any[]) => c[0].type)).toEqual([
      'DOCUMENT',
      'TEXT',
    ]);
  });

  it('um voucher que falha não impede os seguintes', async () => {
    const { service, acceptances, messages } = make();
    acceptances.createForConversation.mockResolvedValue({
      acceptance: { id: 'acc1' },
      link: 'https://sendtur.com.br/aceite/tok',
    });
    messages.send.mockImplementation((dto: any) => {
      if (dto.content?.fileName === 'v1.pdf') throw new Error('arquivo sumiu');
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
      { filename: 'v1.pdf', sent: false, error: 'arquivo sumiu' },
      { filename: 'v2.pdf', sent: true },
    ]);
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
