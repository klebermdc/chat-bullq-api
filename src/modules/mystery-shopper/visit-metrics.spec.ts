import { computeVisitMetrics, scoreFirstReply } from './visit-metrics';
import type { VisitMessage } from './mystery-shopper.types';

const at = (iso: string) => new Date(`2026-11-13T${iso}:00Z`);
let seq = 0;
const msg = (over: Partial<VisitMessage>): VisitMessage => ({
  id: `m${(seq += 1)}`,
  direction: 'INBOUND',
  senderId: null,
  isAutomated: false,
  text: 'oi',
  createdAt: at('10:00'),
  ...over,
});

describe('computeVisitMetrics', () => {
  test('1ª resposta conta a partir da distribuição e ignora Aline e automáticas', () => {
    const messages = [
      msg({ createdAt: at('10:00') }),
      msg({ direction: 'OUTBOUND', senderId: null, createdAt: at('10:01') }), // Aline
      msg({ direction: 'OUTBOUND', senderId: 'u1', isAutomated: true, createdAt: at('10:05') }),
      msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('10:30') }),
    ];

    const metrics = computeVisitMetrics({ messages, assignedAt: at('10:10'), proposalCount: 0, sellerUserId: null });

    expect(metrics.firstHumanReplyMinutes).toBe(20);
    expect(metrics.humanMessages).toBe(1);
  });

  test('sem distribuição, conta desde a 1ª mensagem do cliente', () => {
    const messages = [msg({ createdAt: at('10:00') }), msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('10:45') })];
    expect(computeVisitMetrics({ messages, assignedAt: null, proposalCount: 1, sellerUserId: null })).toMatchObject({
      firstHumanReplyMinutes: 45,
      proposalSent: true,
    });
  });

  test('follow-up = mensagem humana depois da última do cliente', () => {
    const messages = [
      msg({ createdAt: at('10:00') }),
      msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('10:05') }),
      msg({ text: 'vou pensar', createdAt: at('11:00') }),
      msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('13:00') }),
      msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('15:00') }),
    ];

    const metrics = computeVisitMetrics({ messages, assignedAt: null, proposalCount: 0, sellerUserId: null });

    expect(metrics.followUps).toBe(2);
    expect(metrics.firstFollowUpHours).toBe(2);
    expect(metrics.lastShopperMessageAt).toBe(at('11:00').toISOString());
  });

  test('resposta do cliente ao follow-up não apaga o follow-up', () => {
    const messages = [
      msg({ text: 'vou pensar', createdAt: new Date('2026-11-13T10:00:00Z') }),
      msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: new Date('2026-11-14T10:00:00Z') }),
      msg({ text: 'ainda estou vendo', createdAt: new Date('2026-11-14T10:01:00Z') }),
    ];
    const metrics = computeVisitMetrics({ messages, assignedAt: null, proposalCount: 0, sellerUserId: null });
    expect(metrics.followUps).toBe(1);
    expect(metrics.firstFollowUpHours).toBe(24);
    expect(metrics.lastShopperMessageAt).toBe('2026-11-14T10:01:00.000Z');
  });

  test('só conta depois do cliente que o precede: mensagem após inbound mais recente fora da janela não conta', () => {
    const messages = [
      msg({ createdAt: new Date('2026-11-10T10:00:00Z') }),
      msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: new Date('2026-11-13T11:00:00Z') }), // 73h
    ];
    expect(computeVisitMetrics({ messages, assignedAt: null, proposalCount: 0, sellerUserId: null }).followUps).toBe(0);
  });

  test('vendedor que não respondeu', () => {
    const metrics = computeVisitMetrics({ messages: [msg({})], assignedAt: null, proposalCount: 0, sellerUserId: null });
    expect(metrics).toMatchObject({ firstHumanReplyMinutes: null, humanMessages: 0, followUps: 0 });
  });
});

describe('follow-up: janela de 2h a 72h depois da última do cliente', () => {
  const HOUR = 3_600_000;
  const lastInboundAt = at('10:00');
  const withReplyAfter = (hours: number) =>
    computeVisitMetrics({
      messages: [
        msg({ createdAt: lastInboundAt }),
        msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: new Date(lastInboundAt.getTime() + hours * HOUR) }),
      ],
      assignedAt: null,
      proposalCount: 0,
      sellerUserId: 'u1',
    });

  test('resposta 5 minutos depois não é follow-up', () => {
    expect(withReplyAfter(5 / 60).followUps).toBe(0);
  });

  test('resposta 3h depois é follow-up', () => {
    const metrics = withReplyAfter(3);
    expect(metrics.followUps).toBe(1);
    expect(metrics.firstFollowUpHours).toBe(3);
  });

  test('resposta 80h depois fica fora da janela', () => {
    expect(withReplyAfter(80).followUps).toBe(0);
  });

  test('limites 2h e 72h entram', () => {
    expect(withReplyAfter(2).followUps).toBe(1);
    expect(withReplyAfter(72).followUps).toBe(1);
  });
});

describe('computeVisitMetrics com vendedor conhecido', () => {
  const messages = [
    msg({ createdAt: at('10:00') }),
    msg({ direction: 'OUTBOUND', senderId: 'colega', createdAt: at('10:05') }),
    msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('10:30') }),
    msg({ text: 'vou pensar', createdAt: at('11:00') }),
    msg({ direction: 'OUTBOUND', senderId: 'colega', createdAt: at('15:00') }),
    msg({ direction: 'OUTBOUND', senderId: 'u1', createdAt: at('16:00') }),
  ];

  test('mensagens e follow-ups contam só o vendedor; 1ª resposta é de qualquer humano', () => {
    const metrics = computeVisitMetrics({ messages, assignedAt: null, proposalCount: 0, sellerUserId: 'u1' });
    expect(metrics.humanMessages).toBe(2);
    expect(metrics.followUps).toBe(1);
    expect(metrics.firstHumanReplyMinutes).toBe(5);
  });

  test('sem vendedor conhecido, todo humano conta', () => {
    const metrics = computeVisitMetrics({ messages, assignedAt: null, proposalCount: 0, sellerUserId: null });
    expect(metrics.humanMessages).toBe(4);
    expect(metrics.followUps).toBe(2);
  });
});

describe('scoreFirstReply', () => {
  test('faixas de 15 e 60 minutos', () => {
    expect(scoreFirstReply(15)).toBe(2);
    expect(scoreFirstReply(16)).toBe(1);
    expect(scoreFirstReply(60)).toBe(1);
    expect(scoreFirstReply(61)).toBe(0);
    expect(scoreFirstReply(null)).toBe(0);
  });
});
