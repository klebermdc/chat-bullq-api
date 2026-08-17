import { MetaWindowGate } from './meta-window-gate.service';
import { MessageContentType, MessageStatus } from '@prisma/client';

function make(convo: {
  lastInboundAt: Date | null;
  ctwaClidAt: Date | null;
}) {
  const prisma = {
    message: {
      findUnique: jest.fn().mockResolvedValue({
        conversationId: 'conv1',
        conversation: {
          lastInboundAt: convo.lastInboundAt,
          contact: { ctwaClidAt: convo.ctwaClidAt },
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'msg1', conversationId: 'conv1' }),
    },
  } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  return { gate: new MetaWindowGate(prisma, realtime), prisma, realtime };
}

const now = new Date('2026-07-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('MetaWindowGate.blockIfClosed', () => {
  it('texto livre + janela fechada + oficial → bloqueia (marca FAILED, sem enviar)', async () => {
    const { gate, prisma, realtime } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(true);
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg1' },
        data: expect.objectContaining({ status: MessageStatus.FAILED }),
      }),
    );
    expect(realtime.emitToConversation).toHaveBeenCalled();
  });

  it('template → nunca bloqueia (não consulta janela)', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEMPLATE,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('canal não-oficial → nunca bloqueia', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_ZAPPFY',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('CTWA dentro de 72h (CSW fechada) → NÃO bloqueia', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: hoursAgo(40) });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('janela aberta (inbound recente) → NÃO bloqueia', async () => {
    const { gate } = make({ lastInboundAt: hoursAgo(1), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
  });

  it('fail-open: erro inesperado no Prisma → não lança e retorna false', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    prisma.message.findUnique.mockRejectedValue(new Error('db pool timeout'));
    await expect(
      gate.blockIfClosed({
        messageId: 'msg1',
        channelType: 'WHATSAPP_OFFICIAL',
        messageType: MessageContentType.TEXT,
        now,
      }),
    ).resolves.toBe(false);
  });

  it('Messenger + texto livre + fora das 24h → bloqueia', async () => {
    const { gate, prisma, realtime } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'MESSENGER',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(true);
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg1' },
        data: expect.objectContaining({ status: MessageStatus.FAILED }),
      }),
    );
    expect(realtime.emitToConversation).toHaveBeenCalled();
  });

  it('Messenger + texto livre + dentro das 24h → libera', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(2), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'MESSENGER',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  // A extensao de 72h e exclusiva do Click-to-WhatsApp. Se ela vazasse pro
  // Messenger, mandariamos mensagem que a Meta vai recusar — e o atendente
  // veria "enviada" numa mensagem que nunca chegou.
  it('Messenger nao herda a extensao de 72h do CTWA', async () => {
    const { gate } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: hoursAgo(30) });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'MESSENGER',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(true);
  });

  // Guarda de regressao: o mesmo cenario NO WHATSAPP continua liberado pelas
  // 72h do CTWA. Sem este teste, restringir a extensao poderia quebrar o
  // WhatsApp em silencio.
  it('WhatsApp continua liberado pelas 72h do CTWA', async () => {
    const { gate } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: hoursAgo(30) });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
  });
});
