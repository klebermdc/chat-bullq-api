// src/modules/mystery-shopper/mystery-shopper.notifier.spec.ts
import { buildDoneMessage, MysteryShopperNotifier } from './mystery-shopper.notifier';
import type { CriterionScore } from './mystery-shopper.types';

const scores: CriterionScore[] = [
  { criterion: 'a', label: 'Descoberta', score: 2, evidence: '', comment: '', measuredBy: 'AI' },
  { criterion: 'b', label: 'Follow-up', score: 0, evidence: '', comment: '', measuredBy: 'CODE' },
];

describe('buildDoneMessage', () => {
  test('vendedor, nota, ponto fraco e link; nome escapado', () => {
    const text = buildDoneMessage({ sellerName: 'Pedro <b>', totalScore: 72, scores, link: 'https://x/cliente-oculto?visita=v1' });
    expect(text).toContain('Pedro &lt;b&gt;');
    expect(text).toContain('72/100');
    expect(text).toContain('Ponto fraco: Follow-up');
    expect(text).toContain('visita=v1');
  });
});

describe('MysteryShopperNotifier', () => {
  const input = { visitId: 'v1', sellerName: 'Pedro', totalScore: 72, scores };

  test('envia só para os chats configurados', async () => {
    const telegram = { isConfigured: () => true, sendMessage: jest.fn().mockResolvedValue({ ok: true }) };
    const access = { settings: jest.fn().mockResolvedValue({ viewerEmails: [], telegramChatIds: ['111'] }) };
    await new MysteryShopperNotifier(access as never, telegram as never).notifyDone('org', input);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][0]).toBe('111');
  });

  test('lista vazia não envia nada', async () => {
    const telegram = { isConfigured: () => true, sendMessage: jest.fn() };
    const access = { settings: jest.fn().mockResolvedValue({ viewerEmails: [], telegramChatIds: [] }) };
    await new MysteryShopperNotifier(access as never, telegram as never).notifyDone('org', input);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  test('erro do Telegram não derruba a avaliação', async () => {
    const telegram = { isConfigured: () => true, sendMessage: jest.fn().mockRejectedValue(new Error('rede')) };
    const access = { settings: jest.fn().mockResolvedValue({ viewerEmails: [], telegramChatIds: ['111'] }) };
    await expect(
      new MysteryShopperNotifier(access as never, telegram as never).notifyDone('org', input),
    ).resolves.toBeUndefined();
  });
});
