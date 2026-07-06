import { validateTemplateName, assertExamplesComplete } from './template-validation';

describe('template-validation', () => {
  it('aceita nome válido e rejeita inválido', () => {
    expect(validateTemplateName('recuperacao_checkout')).toBe(true);
    expect(validateTemplateName('Recuperacao Checkout')).toBe(false);
    expect(validateTemplateName('nome-com-hifen')).toBe(false);
  });
  it('exige exemplo para cada variável do body', () => {
    expect(() => assertExamplesComplete('Olá {{1}} e {{2}}', { '1': 'Ana' })).toThrow(/exemplo/i);
    expect(() => assertExamplesComplete('Olá {{1}}', { '1': 'Ana' })).not.toThrow();
  });
});
