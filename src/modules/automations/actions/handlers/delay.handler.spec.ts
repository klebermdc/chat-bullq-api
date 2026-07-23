import { DelayHandler } from './delay.handler';
import { ActionContext } from '../action.types';

describe('DelayHandler', () => {
  const handler = new DelayHandler();
  const ctx = {} as ActionContext; // delay não toca DB/outbox

  describe('validateParams', () => {
    it('aceita unidade e valor válidos', () => {
      expect(() => handler.validateParams({ unit: 'hours', value: 24 })).not.toThrow();
    });
    it('rejeita unidade inválida', () => {
      expect(() => handler.validateParams({ unit: 'weeks', value: 1 })).toThrow(/unit/);
    });
    it('rejeita valor <= 0', () => {
      expect(() => handler.validateParams({ unit: 'days', value: 0 })).toThrow(/value/);
    });
    it('rejeita valor não inteiro', () => {
      expect(() => handler.validateParams({ unit: 'minutes', value: 1.5 })).toThrow(/value/);
    });
  });

  describe('execute', () => {
    it('retorna control.delay com resumeAt no futuro correto', async () => {
      const before = Date.now();
      const res = await handler.execute({ unit: 'hours', value: 2 }, ctx);
      expect(res.ok).toBe(true);
      expect(res.control?.type).toBe('delay');
      const resumeMs = new Date(res.control!.resumeAt).getTime();
      expect(resumeMs - before).toBeGreaterThanOrEqual(7_200_000 - 50);
      expect(resumeMs - before).toBeLessThan(7_200_000 + 5_000);
    });
  });
});
