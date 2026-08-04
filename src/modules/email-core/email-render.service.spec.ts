import { EmailRenderService } from './email-render.service';
import { parseEmailContent, applyVariables } from './email-blocks.types';

describe('parseEmailContent', () => {
  it('aceita conteúdo válido', () => {
    expect(parseEmailContent({ blocks: [{ type: 'text', text: 'oi' }] }).blocks).toHaveLength(1);
  });

  it.each([
    [{}, /esperado/],
    [{ blocks: [] }, /pelo menos um bloco/],
    [{ blocks: [{ type: 'foo' }] }, /tipo desconhecido/],
    [{ blocks: [{ type: 'text', text: '  ' }] }, /exige texto/],
    [{ blocks: [{ type: 'button', label: 'ok' }] }, /exige label e href/],
  ])('rejeita %j', (input, re) => {
    expect(() => parseEmailContent(input)).toThrow(re as RegExp);
  });
});

describe('applyVariables', () => {
  it('substitui as variáveis conhecidas', () => {
    expect(applyVariables('Olá {{nome}}!', { nome: 'João', email: 'j@e.com' })).toBe('Olá João!');
  });

  it('troca placeholder desconhecido por vazio em vez de vazar {{}} no email', () => {
    expect(applyVariables('Oi {{sobrenome}}.', { email: 'j@e.com' })).toBe('Oi .');
  });
});

describe('EmailRenderService', () => {
  const service = new EmailRenderService();
  const content = {
    blocks: [
      { type: 'heading' as const, text: 'Sua viagem começa' },
      { type: 'text' as const, text: 'Olá {{nome}}, temos novidade.' },
      { type: 'button' as const, label: 'Ver ingressos', href: 'https://exemplo.com/ingressos' },
    ],
  };
  const vars = { nome: 'João', email: 'joao@exemplo.com' };
  const unsubscribeUrl = 'https://app.exemplo.com.br/descadastro/tok123';

  it('renderiza HTML com o conteúdo e as variáveis aplicadas', async () => {
    const { html } = await service.render(content, vars, unsubscribeUrl);
    expect(html).toContain('Sua viagem começa');
    expect(html).toContain('Olá João');
    expect(html).toContain('https://exemplo.com/ingressos');
    expect(html).toContain('<html');
  });

  it('sempre inclui o link de descadastro — sem ele o domínio vira spam', async () => {
    const { html } = await service.render(content, vars, unsubscribeUrl);
    expect(html).toContain(unsubscribeUrl);
  });

  it('gera versão texto puro sem tags', async () => {
    const { text } = await service.render(content, vars, unsubscribeUrl);
    expect(text).toContain('Olá João');
    expect(text).not.toContain('<html');
  });

  it('não deixa placeholder cru escapar para o HTML', async () => {
    const { html } = await service.render(content, { email: 'j@e.com' }, unsubscribeUrl);
    expect(html).not.toContain('{{nome}}');
  });

  it('não muta o conteúdo original entre destinatários', async () => {
    await service.render(content, { nome: 'João', email: 'a@b.com' }, unsubscribeUrl);
    const { html } = await service.render(content, { nome: 'Maria', email: 'c@d.com' }, unsubscribeUrl);
    expect(html).toContain('Olá Maria');
    expect(html).not.toContain('João');
  });
});
