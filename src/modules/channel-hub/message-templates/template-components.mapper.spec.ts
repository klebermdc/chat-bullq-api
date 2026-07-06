import { toGraphComponents, countBodyVariables } from './template-components.mapper';
import { TemplateComponents } from './template-components.types';

describe('template-components.mapper', () => {
  it('conta variáveis do body', () => {
    expect(countBodyVariables('Olá {{1}}, seu {{2}} está pronto')).toBe(2);
    expect(countBodyVariables('sem variáveis')).toBe(0);
  });

  it('mapeia body com exemplos para components da Graph API', () => {
    const c: TemplateComponents = { body: { text: 'Olá {{1}}, {{2}}' } };
    const out = toGraphComponents(c, { '1': 'Ana', '2': 'Ingresso' });
    expect(out).toContainEqual({ type: 'BODY', text: 'Olá {{1}}, {{2}}', example: { body_text: [['Ana', 'Ingresso']] } });
  });

  it('mapeia header de texto e footer', () => {
    const c: TemplateComponents = { header: { format: 'TEXT', text: 'Fast Pass' }, body: { text: 'oi' }, footer: { text: 'Responda SAIR para parar' } };
    const out = toGraphComponents(c, {});
    expect(out).toContainEqual({ type: 'HEADER', format: 'TEXT', text: 'Fast Pass' });
    expect(out).toContainEqual({ type: 'FOOTER', text: 'Responda SAIR para parar' });
  });

  it('mapeia botões (quick reply, url, phone)', () => {
    const c: TemplateComponents = { body: { text: 'oi' }, buttons: [ { type: 'QUICK_REPLY', text: 'Parar' }, { type: 'URL', text: 'Site', url: 'https://x.com' }, { type: 'PHONE_NUMBER', text: 'Ligar', phone: '5511999998888' } ] };
    const out = toGraphComponents(c, {});
    expect(out).toContainEqual({ type: 'BUTTONS', buttons: [ { type: 'QUICK_REPLY', text: 'Parar' }, { type: 'URL', text: 'Site', url: 'https://x.com' }, { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '5511999998888' } ] });
  });
});
