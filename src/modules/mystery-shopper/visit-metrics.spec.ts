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

  test('vendedor que não respondeu', () => {
    const metrics = computeVisitMetrics({ messages: [msg({})], assignedAt: null, proposalCount: 0, sellerUserId: null });
    expect(metrics).toMatchObject({ firstHumanReplyMinutes: null, humanMessages: 0, followUps: 0 });
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
