import { EmailRenderService } from './email-render.service';
import { parseEmailContent, applyVariables, DEFAULT_THEME } from './email-blocks.types';

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
    theme: DEFAULT_THEME,
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

describe('EmailRenderService — tema e estilo', () => {
  const service = new EmailRenderService();
  const url = 'https://app.exemplo.com.br/descadastro/tok';
  const vars = { nome: 'João', email: 'j@e.com' };

  it('aplica a cor primária do tema no botão', async () => {
    const { html } = await service.render(
      {
        theme: { ...DEFAULT_THEME, primaryColor: '#ff0000' },
        blocks: [{ type: 'button', label: 'Ir', href: 'https://x' }],
      },
      vars,
      url,
    );
    expect(html).toContain('#ff0000');
  });

  it('estilo do bloco vence o tema', async () => {
    const { html } = await service.render(
      {
        theme: { ...DEFAULT_THEME, primaryColor: '#ff0000' },
        blocks: [{ type: 'button', label: 'Ir', href: 'https://x', style: { buttonColor: '#00ff00' } }],
      },
      vars,
      url,
    );
    expect(html).toContain('#00ff00');
  });

  it('renderiza card de oferta com título, preço e botão', async () => {
    const { html } = await service.render(
      {
        theme: DEFAULT_THEME,
        blocks: [{ type: 'offer', title: 'Disney 5 dias', price: 'a partir de R$ 1.299', label: 'Quero', href: 'https://x' }],
      },
      vars,
      url,
    );
    expect(html).toContain('Disney 5 dias');
    expect(html).toContain('a partir de R$ 1.299');
    expect(html).toContain('Quero');
  });

  it('renderiza ícones de redes sociais como img', async () => {
    const { html } = await service.render(
      {
        theme: DEFAULT_THEME,
        blocks: [{ type: 'social', links: [{ network: 'instagram', href: 'https://ig/x' }] }],
      },
      vars,
      url,
    );
    expect(html).toContain('https://ig/x');
    expect(html).toMatch(/<img[^>]+instagram/);
  });

  it('espaçador vira altura, não texto', async () => {
    const { html } = await service.render(
      { theme: DEFAULT_THEME, blocks: [{ type: 'spacer', size: 'lg' }, { type: 'text', text: 'oi' }] },
      vars,
      url,
    );
    expect(html).toContain('oi');
    expect(html).not.toContain('spacer');
  });

  it('logo com href vira link clicável', async () => {
    const { html } = await service.render(
      { theme: DEFAULT_THEME, blocks: [{ type: 'logo', src: 'https://x/l.png', href: 'https://site' }] },
      vars,
      url,
    );
    expect(html).toContain('https://site');
  });
});
