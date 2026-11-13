import { BadRequestException, NotFoundException } from '@nestjs/common';
import { confirmationText, slotLabel, VoiceToolsService } from './voice-tools.service';

const sp = (iso: string) => new Date(`${iso}-03:00`);
const TZ = 'America/Sao_Paulo';

function make(opts: { conv?: any; lastInboundAt?: Date | null } = {}) {
  const conv =
    opts.conv === undefined
      ? {
          id: 'cv1',
          organizationId: 'org1',
          channelId: 'ch1',
          contactId: 'c1',
          assignedToId: 'renata',
          lastInboundAt: opts.lastInboundAt ?? null,
          metaWindowExpiresAt: null,
          channel: { type: 'WHATSAPP_OFFICIAL' },
          contact: { name: 'Kleber', ctwaClidAt: null },
          assignedTo: { name: 'Renata' },
          organization: { aiTimezone: TZ },
        }
      : opts.conv;
  const prisma = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conv) },
    card: { findFirst: jest.fn().mockResolvedValue({ id: 'card1' }) },
    contactChannel: { findFirst: jest.fn().mockResolvedValue({ externalId: '5511999990000' }) },
    message: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `m-${data.type}`, ...data })) },
  } as any;
  const agenda = {
    freeSlots: jest.fn().mockResolvedValue([sp('2026-11-16T15:00:00'), sp('2026-11-16T15:30:00')]),
    createForAline: jest.fn().mockImplementation(async (_o: string, _u: string, i: any) => ({ id: 'ap1', startsAt: new Date(i.startsAt), notes: i.notes ?? null })),
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const queue = { add: jest.fn().mockResolvedValue({}) } as any;
  return { svc: new VoiceToolsService(prisma, agenda, realtime, queue), prisma, agenda, queue };
}

describe('textos falados', () => {
  it('formata o horário como a Aline fala', () => {
    expect(slotLabel(sp('2026-11-16T15:00:00'), TZ)).toBe('segunda-feira, 16/11 às 15:00');
    expect(confirmationText('Renata', 'segunda-feira, 16/11 às 15:00')).toBe(
      'Combinado! Renata vai te ligar segunda-feira, 16/11 às 15:00. Qualquer coisa, é só chamar por aqui.',
    );
  });
});

describe('VoiceToolsService.freeSlots', () => {
  it('usa o vendedor dono da conversa e devolve horários falados', async () => {
    const { svc, agenda } = make();
    const r = await svc.freeSlots('cv1', 2);
    expect(agenda.freeSlots).toHaveBeenCalledWith('org1', 'renata', { count: 2 });
    expect(r).toEqual({
      vendedor: 'Renata',
      horarios: [
        { inicio: sp('2026-11-16T15:00:00').toISOString(), falado: 'segunda-feira, 16/11 às 15:00' },
        { inicio: sp('2026-11-16T15:30:00').toISOString(), falado: 'segunda-feira, 16/11 às 15:30' },
      ],
    });
  });

  it('conversa inexistente dá 404; sem vendedor dá SEM_VENDEDOR', async () => {
    await expect(make({ conv: null }).svc.freeSlots('x')).rejects.toBeInstanceOf(NotFoundException);
    const semDono = make({ conv: { id: 'cv1', organizationId: 'org1', assignedToId: null } });
    await expect(semDono.svc.freeSlots('cv1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VoiceToolsService.schedule', () => {
  it('marca como Aline (voz), põe aviso na conversa e não manda WhatsApp com a janela fechada', async () => {
    const { svc, agenda, prisma, queue } = make({ lastInboundAt: new Date(Date.now() - 48 * 3600_000) });
    const r = await svc.schedule({ conversationId: 'cv1', startsAt: '2026-11-16T15:00:00-03:00', notes: 'quer falar das datas' });
    expect(agenda.createForAline).toHaveBeenCalledWith(
      'org1',
      'renata',
      expect.objectContaining({ contactId: 'c1', conversationId: 'cv1', cardId: 'card1', notes: 'quer falar das datas' }),
      'ALINE_VOZ',
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'SYSTEM', content: expect.objectContaining({ text: expect.stringContaining('Aline marcou retorno com Renata') }) }) }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, compromissoId: 'ap1', falado: 'segunda-feira, 16/11 às 15:00', confirmacaoEnviada: false });
  });

  it('com a janela aberta, manda a confirmação pelo WhatsApp', async () => {
    const { svc, queue } = make({ lastInboundAt: new Date(Date.now() - 3600_000) });
    const r = await svc.schedule({ conversationId: 'cv1', startsAt: '2026-11-16T15:00:00-03:00' });
    expect(queue.add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({ contactExternalId: '5511999990000', message: expect.objectContaining({ content: { text: expect.stringContaining('Renata vai te ligar') } }) }),
      expect.anything(),
    );
    expect(r.confirmacaoEnviada).toBe(true);
  });
});
