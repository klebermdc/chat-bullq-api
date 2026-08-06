import { ScheduledDispatchProcessor } from './scheduled-dispatch.processor';

function makeDeps(row: any) {
  const repo = {
    findById: jest.fn(async () => row),
    create: jest.fn(async (d: any) => ({ id: 's2', ...d })),
    update: jest.fn(async (id: string, data: any) => ({ ...row, ...data })),
    claimForDispatch: jest.fn(async () => true),
  };
  const prisma = {
    conversation: {
      findUnique: jest.fn(async () => ({
        id: 'c1',
        status: 'OPEN',
        isArchived: false,
        lastInboundAt: null,
      })),
    },
  };
  const messages = { send: jest.fn(async () => ({ id: 'm1' })) };
  const queue = { add: jest.fn(async () => ({ id: 'j' })) };
  const cadenceRunner = { onStepSent: jest.fn(async () => undefined) };
  const processor = new ScheduledDispatchProcessor(
    repo as any,
    prisma as any,
    messages as any,
    queue as any,
    cadenceRunner as any,
  );
  return { processor, repo, messages, queue, cadenceRunner };
}

describe('ScheduledDispatchProcessor', () => {
  const base = {
    id: 's1', status: 'PENDING', conversationId: 'c1', organizationId: 'org1',
    createdById: 'user1', contentType: 'TEXT', content: { text: 'oi' },
    origin: 'MANUAL', attempt: 1, maxAttempts: 1,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
  };

  it('envia e marca SENT', async () => {
    const { processor, repo, messages } = makeDeps(base);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'SENT', sentMessageId: 'm1' }));
  });

  it('no-op idempotente quando já não está PENDING', async () => {
    const { processor, messages } = makeDeps({ ...base, status: 'CANCELED' });
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('não envia quando o claim atômico falha (cancelado entre leitura e envio)', async () => {
    const { processor, repo, messages } = makeDeps(base);
    repo.claimForDispatch.mockResolvedValueOnce(false);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'SENT' }),
    );
  });

  it('backstop: cancela (client_replied) quando o cliente respondeu após criar o agendamento', async () => {
    const row = { ...base, origin: 'AUTO_REENGAGE' };
    const repo = {
      findById: jest.fn(async () => row),
      update: jest.fn(async (id: string, d: any) => ({ ...row, ...d })),
      claimForDispatch: jest.fn(async () => true),
    };
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'c1',
          status: 'OPEN',
          isArchived: false,
          lastInboundAt: new Date('2021-01-01T00:00:00.000Z'),
        })),
      },
    };
    const messages = { send: jest.fn() };
    const queue = { add: jest.fn(async () => ({ id: 'j' })) };
    const processor = new ScheduledDispatchProcessor(
      repo as any,
      prisma as any,
      messages as any,
      queue as any,
      { onStepSent: jest.fn(async () => undefined) } as any,
    );
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
    expect(repo.claimForDispatch).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'CANCELED', cancelReason: 'client_replied' }),
    );
  });

  it('marca FAILED quando a conversa está fechada', async () => {
    const row = { ...base };
    const repo = { findById: jest.fn(async () => row), update: jest.fn(async (id, d) => ({ ...row, ...d })) };
    const prisma = { conversation: { findUnique: jest.fn(async () => ({ id: 'c1', status: 'CLOSED', isArchived: false })) } };
    const messages = { send: jest.fn() };
    const queue = { add: jest.fn(async () => ({ id: 'j' })) };
    const processor = new ScheduledDispatchProcessor(
      repo as any,
      prisma as any,
      messages as any,
      queue as any,
      { onStepSent: jest.fn(async () => undefined) } as any,
    );
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'FAILED' }));
  });

  it('cancela not_ai_parked quando requireAiParked e a conversa foi para humano', async () => {
    const row = { ...base, origin: 'AUTO_REENGAGE', requireAiParked: true };
    const repo = {
      findById: jest.fn(async () => row),
      update: jest.fn(async (id: string, d: any) => ({ ...row, ...d })),
      claimForDispatch: jest.fn(async () => true),
    };
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'c1', status: 'OPEN', isArchived: false, lastInboundAt: null,
          assignedToId: 'u1', awaitingHumanReply: false, aiEnabled: null,
        })),
      },
    };
    const messages = { send: jest.fn() };
    const queue = { add: jest.fn(async () => ({ id: 'j' })) };
    const processor = new ScheduledDispatchProcessor(
      repo as any, prisma as any, messages as any, queue as any,
      { onStepSent: jest.fn(async () => undefined) } as any,
    );
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
    expect(repo.claimForDispatch).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({
      status: 'CANCELED', cancelReason: 'not_ai_parked',
    }));
  });

  it('envia normalmente quando requireAiParked e a conversa ainda está parada na IA', async () => {
    const row = { ...base, origin: 'CADENCE', requireAiParked: true, cadenceEnrollmentId: 'e1', cadenceStepOrder: 1 };
    const repo = {
      findById: jest.fn(async () => row),
      update: jest.fn(async (id: string, d: any) => ({ ...row, ...d })),
      claimForDispatch: jest.fn(async () => true),
    };
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'c1', status: 'OPEN', isArchived: false, lastInboundAt: null,
          assignedToId: null, awaitingHumanReply: false, aiEnabled: null,
        })),
      },
    };
    const messages = { send: jest.fn(async () => ({ id: 'm1' })) };
    const queue = { add: jest.fn(async () => ({ id: 'j' })) };
    const processor = new ScheduledDispatchProcessor(
      repo as any, prisma as any, messages as any, queue as any,
      { onStepSent: jest.fn(async () => undefined) } as any,
    );
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).toHaveBeenCalled();
  });

  it('AUTO_REENGAGE esgotado (último toque): move o card para exhaustedStageId (LOST)', async () => {
    const row = { ...base, origin: 'AUTO_REENGAGE', attempt: 2, maxAttempts: 2, exhaustedStageId: 'stg1', contactId: 'ct1', channelId: 'ch1' };
    const repo = {
      findById: jest.fn(async () => row),
      update: jest.fn(async (id: string, d: any) => ({ ...row, ...d })),
      claimForDispatch: jest.fn(async () => true),
      create: jest.fn(),
    };
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ id: 'c1', status: 'OPEN', isArchived: false, lastInboundAt: null, assignedToId: null, awaitingHumanReply: false, aiEnabled: null })) },
      pipelineStage: { findUnique: jest.fn(async () => ({ id: 'stg1', pipelineId: 'pl1' })) },
      card: { findFirst: jest.fn(async () => ({ id: 'card1' })), update: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
      contact: { findUnique: jest.fn(async () => ({ name: 'Fulano' })) },
    };
    const messages = { send: jest.fn(async () => ({ id: 'm1' })) };
    const queue = { add: jest.fn(async () => ({ id: 'j' })) };
    const processor = new ScheduledDispatchProcessor(repo as any, prisma as any, messages as any, queue as any, { onStepSent: jest.fn() } as any);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(prisma.card.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'card1' },
      data: expect.objectContaining({ stageId: 'stg1', status: 'LOST' }),
    }));
    expect(prisma.card.create).not.toHaveBeenCalled();
  });

  it('AUTO_REENGAGE esgotado sem card: cria card na etapa (LOST)', async () => {
    const row = { ...base, origin: 'AUTO_REENGAGE', attempt: 2, maxAttempts: 2, exhaustedStageId: 'stg1', contactId: 'ct1', channelId: 'ch1' };
    const repo = {
      findById: jest.fn(async () => row),
      update: jest.fn(async (id: string, d: any) => ({ ...row, ...d })),
      claimForDispatch: jest.fn(async () => true),
      create: jest.fn(),
    };
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ id: 'c1', status: 'OPEN', isArchived: false, lastInboundAt: null, assignedToId: null, awaitingHumanReply: false, aiEnabled: null })) },
      pipelineStage: { findUnique: jest.fn(async () => ({ id: 'stg1', pipelineId: 'pl1' })) },
      card: { findFirst: jest.fn(async () => null), update: jest.fn(async () => ({})), create: jest.fn(async () => ({})) },
      contact: { findUnique: jest.fn(async () => ({ name: 'Fulano' })) },
    };
    const messages = { send: jest.fn(async () => ({ id: 'm1' })) };
    const queue = { add: jest.fn(async () => ({ id: 'j' })) };
    const processor = new ScheduledDispatchProcessor(repo as any, prisma as any, messages as any, queue as any, { onStepSent: jest.fn() } as any);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(prisma.card.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stageId: 'stg1', pipelineId: 'pl1', status: 'LOST', conversationId: 'c1' }),
    }));
  });

  it('AUTO_REENGAGE com tentativas restantes: agenda o próximo (attempt+1) após SENT', async () => {
    const row = {
      ...base,
      origin: 'AUTO_REENGAGE',
      attempt: 1,
      maxAttempts: 2,
      retryEveryHours: 48,
      contactId: 'ct1',
      channelId: 'ch1',
    };
    const { processor, repo, queue } = makeDeps(row);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'AUTO_REENGAGE',
        attempt: 2,
        maxAttempts: 2,
        contactId: 'ct1',
        channelId: 'ch1',
      }),
    );
    expect(queue.add).toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s2', { jobId: 'j' });
  });

  it('AUTO_REENGAGE na última tentativa: NÃO agenda próximo', async () => {
    const row = {
      ...base,
      origin: 'AUTO_REENGAGE',
      attempt: 2,
      maxAttempts: 2,
      retryEveryHours: 48,
    };
    const { processor, repo } = makeDeps(row);
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(repo.create).not.toHaveBeenCalled();
  });

  // ─── Template HSM fora da janela (canal oficial) ────────────
  describe('fallback para template HSM fora da janela', () => {
    const OFICIAL = {
      id: 'c1',
      status: 'OPEN',
      isArchived: false,
      assignedToId: null,
      awaitingHumanReply: false,
      aiEnabled: null,
      channel: { type: 'WHATSAPP_OFFICIAL' },
      contact: { name: 'Maria Souza', ctwaClidAt: null },
    };

    /** Deps com canal/contato e um template aprovado disponível. */
    function makeOfficialDeps(
      row: any,
      conversation: any,
      template: any = {
        id: 'tpl1',
        name: 'candecia1',
        language: 'pt_BR',
        status: 'APPROVED',
        components: { body: { text: 'Oi {{1}}, viu a proposta?' } },
        variableExamples: {},
      },
    ) {
      const repo = {
        findById: jest.fn(async () => row),
        create: jest.fn(async (d: any) => ({ id: 's2', ...d })),
        update: jest.fn(async (id: string, d: any) => ({ ...row, ...d })),
        claimForDispatch: jest.fn(async () => true),
      };
      const prisma = {
        conversation: { findUnique: jest.fn(async () => conversation) },
        messageTemplate: { findFirst: jest.fn(async () => template) },
      };
      const messages = { send: jest.fn(async () => ({ id: 'm1' })) };
      const queue = { add: jest.fn(async () => ({ id: 'j' })) };
      const cadenceRunner = { onStepSent: jest.fn(async () => undefined) };
      const processor = new ScheduledDispatchProcessor(
        repo as any,
        prisma as any,
        messages as any,
        queue as any,
        cadenceRunner as any,
      );
      return { processor, repo, messages, prisma, cadenceRunner };
    }

    const cadenceRow = {
      ...base,
      origin: 'CADENCE',
      cadenceEnrollmentId: 'e1',
      cadenceStepOrder: 1,
      templateId: 'tpl1',
      content: { text: 'Oi! Tudo bem?\n\n1 - Sim\n2 - Não' },
      // agendado depois da última entrada do cliente (senão o backstop
      // `client_replied` cancela antes de chegar na janela).
      createdAt: new Date(Date.now() - 3600_000),
    };

    it('envia o template HSM quando a janela de 24h já fechou', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 30 * 3600_000),
      };
      const { processor, messages } = makeOfficialDeps(cadenceRow, conversation);

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TEMPLATE',
          content: {
            name: 'candecia1',
            language: { code: 'pt_BR' },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: 'Maria' }] },
            ],
          },
        }),
        'user1',
        'org1',
        'ALL',
        undefined,
        { system: true },
      );
    });

    it('mantém o texto livre quando a janela ainda está aberta', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 2 * 3600_000),
      };
      const { processor, messages } = makeOfficialDeps(cadenceRow, conversation);

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(messages.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TEXT', content: cadenceRow.content }),
        'user1',
        'org1',
        'ALL',
        undefined,
        { system: true },
      );
    });

    it('mantém o texto livre em canal não-oficial (sem regra de janela)', async () => {
      const conversation = {
        ...OFICIAL,
        channel: { type: 'WHATSAPP_ZAPPFY' },
        lastInboundAt: new Date(Date.now() - 30 * 3600_000),
      };
      const { processor, messages, prisma } = makeOfficialDeps(
        cadenceRow,
        conversation,
      );

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(prisma.messageTemplate.findFirst).not.toHaveBeenCalled();
      expect(messages.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TEXT' }),
        'user1',
        'org1',
        'ALL',
        undefined,
        { system: true },
      );
    });

    it('janela fechada e template não aprovado: não envia e falha com motivo claro', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 30 * 3600_000),
      };
      const { processor, repo, messages } = makeOfficialDeps(
        cadenceRow,
        conversation,
        { id: 'tpl1', name: 'candecia1', language: 'pt_BR', status: 'PENDING', components: { body: { text: 'Oi' } } },
      );

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(messages.send).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          status: 'FAILED',
          failedReason: expect.stringContaining('template'),
        }),
      );
    });

    it('janela fechada e passo sem template: não envia e falha com motivo claro', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 30 * 3600_000),
      };
      const { processor, repo, messages } = makeOfficialDeps(
        { ...cadenceRow, templateId: null },
        conversation,
      );

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(messages.send).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          status: 'FAILED',
          failedReason: expect.stringContaining('template'),
        }),
      );
    });

    // Regressão 2026-08-06: lead de anúncio cuja inbound não trouxe `referral`
    // (comum sob pricing PMP) tinha ctwaClidAt null, então o toque de +24h caía
    // como "janela fechada" e a cadência morria sem enviar nada — mesmo com a
    // Meta tendo concedido 72h de free entry point no webhook de status.
    it('texto livre PASSA quando a Meta concedeu 72h, mesmo sem ctwaClidAt', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 30 * 3600_000), // CSW de 24h fechada
        metaWindowExpiresAt: new Date(Date.now() + 42 * 3600_000), // 72h da Meta
      };
      const { processor, repo, messages } = makeOfficialDeps(
        { ...cadenceRow, templateId: null }, // passo sem HSM — antes morria aqui
        conversation,
      );

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(messages.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TEXT', content: cadenceRow.content }),
        'user1',
        'org1',
        'ALL',
        undefined,
        { system: true },
      );
      expect(repo.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ status: 'SENT' }),
      );
    });

    it('toque bloqueado ainda avança a cadência (matrícula não fica ACTIVE para sempre)', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 30 * 3600_000),
      };
      const { processor, cadenceRunner } = makeOfficialDeps(
        { ...cadenceRow, templateId: null },
        conversation,
      );

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(cadenceRunner.onStepSent).toHaveBeenCalledWith('e1', 1);
    });

    it('preenche as variáveis extras do template com os exemplos cadastrados', async () => {
      const conversation = {
        ...OFICIAL,
        lastInboundAt: new Date(Date.now() - 30 * 3600_000),
      };
      const { processor, messages } = makeOfficialDeps(cadenceRow, conversation, {
        id: 'tpl1',
        name: 'candecia2',
        language: 'pt_BR',
        status: 'APPROVED',
        components: { body: { text: 'Oi {{1}}, sua viagem para {{2}}' } },
        variableExamples: { '2': 'Orlando' },
      });

      await processor.process({ data: { scheduledMessageId: 's1' } } as any);

      expect(messages.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Maria' },
                  { type: 'text', text: 'Orlando' },
                ],
              },
            ],
          }),
        }),
        'user1',
        'org1',
        'ALL',
        undefined,
        { system: true },
      );
    });
  });
});
