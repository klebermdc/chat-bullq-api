import { computeDiaryMetrics } from './diary-metrics';
import type { DiaryMessage } from './diary.types';

const USER = 'u1';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 30, h, m));
const msg = (
  conversationId: string,
  direction: 'INBOUND' | 'OUTBOUND',
  when: Date,
  senderId: string | null = null,
): DiaryMessage => ({ conversationId, direction, senderId, text: 'oi', at: when });
const alwaysWorking = () => true;

describe('computeDiaryMetrics', () => {
  test('conta conversas e mensagens só do atendente', () => {
    const metrics = computeDiaryMetrics(
      [
        msg('c1', 'INBOUND', at(10)),
        msg('c1', 'OUTBOUND', at(10, 5), USER),
        msg('c2', 'INBOUND', at(11)),
        msg('c2', 'OUTBOUND', at(11, 5), 'outro'),
      ],
      USER,
      alwaysWorking,
    );

    expect(metrics.conversations).toBe(1);
    expect(metrics.messagesSent).toBe(1);
  });

  test('usa a mediana, para uma demora isolada não distorcer o dia', () => {
    const metrics = computeDiaryMetrics(
      [
        msg('c1', 'INBOUND', at(10)),
        msg('c1', 'OUTBOUND', at(10, 2), USER),
        msg('c2', 'INBOUND', at(10)),
        msg('c2', 'OUTBOUND', at(10, 4), USER),
        msg('c3', 'INBOUND', at(10)),
        msg('c3', 'OUTBOUND', at(13), USER),
      ],
      USER,
      alwaysWorking,
    );

    expect(metrics.medianReplyMinutes).toBe(4);
    expect(metrics.slowReplies).toBe(1);
  });

  test('mensagem recebida fora do horário não conta como demora', () => {
    const isWorking = (d: Date) => d.getUTCHours() >= 9;

    const metrics = computeDiaryMetrics(
      [
        msg('c1', 'INBOUND', at(3)),
        msg('c1', 'OUTBOUND', at(9), USER),
      ],
      USER,
      isWorking,
    );

    expect(metrics.medianReplyMinutes).toBeNull();
    expect(metrics.slowReplies).toBe(0);
  });

  test('resposta do robô não encerra a espera do cliente', () => {
    const metrics = computeDiaryMetrics(
      [
        msg('c1', 'INBOUND', at(10)),
        msg('c1', 'OUTBOUND', at(10, 1), null),
        msg('c1', 'OUTBOUND', at(10, 20), USER),
      ],
      USER,
      alwaysWorking,
    );

    expect(metrics.medianReplyMinutes).toBe(20);
  });

  test('conta cliente que terminou o dia sem resposta', () => {
    const metrics = computeDiaryMetrics(
      [
        msg('c1', 'OUTBOUND', at(10), USER),
        msg('c1', 'INBOUND', at(11)),
        msg('c2', 'INBOUND', at(12)),
        msg('c2', 'OUTBOUND', at(12, 1), USER),
      ],
      USER,
      alwaysWorking,
    );

    expect(metrics.unansweredAtEndOfDay).toBe(1);
  });

  test('dia sem mensagens devolve zeros', () => {
    expect(computeDiaryMetrics([], USER, alwaysWorking)).toEqual({
      conversations: 0,
      messagesSent: 0,
      medianReplyMinutes: null,
      slowReplies: 0,
      unansweredAtEndOfDay: 0,
    });
  });
});
