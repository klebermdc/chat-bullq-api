import { parseEmailContent, DEFAULT_THEME } from './email-blocks.types';

const bloco = (extra: Record<string, unknown>) => ({ blocks: [extra] });

describe('parseEmailContent — tipos novos', () => {
  it('aceita logo com src', () => {
    expect(parseEmailContent(bloco({ type: 'logo', src: 'https://x/y.png' })).blocks).toHaveLength(1);
  });

  it('recusa logo sem src', () => {
    expect(() => parseEmailContent(bloco({ type: 'logo' }))).toThrow(/exige src/);
  });

  it('aceita spacer com tamanho conhecido', () => {
    expect(parseEmailContent(bloco({ type: 'spacer', size: 'md' })).blocks).toHaveLength(1);
  });

  it('recusa spacer com tamanho inventado', () => {
    expect(() => parseEmailContent(bloco({ type: 'spacer', size: 'gigante' }))).toThrow(/size/);
  });

  it('aceita offer completa', () => {
    const c = bloco({ type: 'offer', title: 'Disney 5 dias', label: 'Quero', href: 'https://x' });
    expect(parseEmailContent(c).blocks).toHaveLength(1);
  });

  it('recusa offer sem link — card de oferta sem link não serve para nada', () => {
    expect(() =>
      parseEmailContent(bloco({ type: 'offer', title: 'Disney', label: 'Quero' })),
    ).toThrow(/href/);
  });

  it('aceita social com pelo menos um link', () => {
    const c = bloco({ type: 'social', links: [{ network: 'instagram', href: 'https://ig/x' }] });
    expect(parseEmailContent(c).blocks).toHaveLength(1);
  });

  it('recusa social sem nenhum link', () => {
    expect(() => parseEmailContent(bloco({ type: 'social', links: [] }))).toThrow(/pelo menos um/);
  });

  it('recusa rede social desconhecida', () => {
    const c = bloco({ type: 'social', links: [{ network: 'orkut', href: 'https://x' }] });
    expect(() => parseEmailContent(c)).toThrow(/orkut/);
  });
});

describe('parseEmailContent — esquema de href', () => {
  it('aceita https: em button', () => {
    const c = bloco({ type: 'button', label: 'Quero', href: 'https://exemplo.com/oferta' });
    expect(parseEmailContent(c).blocks).toHaveLength(1);
  });

  it('recusa javascript: em button', () => {
    expect(() =>
      parseEmailContent(bloco({ type: 'button', label: 'Quero', href: 'javascript:alert(1)' })),
    ).toThrow(/esquema/);
  });

  it('recusa data: em button', () => {
    expect(() =>
      parseEmailContent(
        bloco({ type: 'button', label: 'Quero', href: 'data:text/html,<script>alert(1)</script>' }),
      ),
    ).toThrow(/esquema/);
  });

  it('recusa javascript: em offer', () => {
    expect(() =>
      parseEmailContent(
        bloco({ type: 'offer', title: 'Disney', label: 'Quero', href: 'javascript:alert(1)' }),
      ),
    ).toThrow(/esquema/);
  });

  it('recusa data: em social', () => {
    const c = bloco({ type: 'social', links: [{ network: 'instagram', href: 'data:text/html,x' }] });
    expect(() => parseEmailContent(c)).toThrow(/esquema/);
  });

  it('aceita mailto: em social', () => {
    const c = bloco({ type: 'social', links: [{ network: 'site', href: 'mailto:contato@exemplo.com' }] });
    expect(parseEmailContent(c).blocks).toHaveLength(1);
  });

  it('recusa javascript: em logo, quando href informado', () => {
    expect(() =>
      parseEmailContent(bloco({ type: 'logo', src: 'https://x/y.png', href: 'javascript:alert(1)' })),
    ).toThrow(/esquema/);
  });

  it('logo sem href não é afetado pela checagem de esquema', () => {
    expect(parseEmailContent(bloco({ type: 'logo', src: 'https://x/y.png' })).blocks).toHaveLength(1);
  });
});

describe('parseEmailContent — tema', () => {
  it('conteúdo da Fatia 1, sem tema, continua válido', () => {
    const c = parseEmailContent({ blocks: [{ type: 'text', text: 'oi' }] });
    expect(c.theme).toEqual(DEFAULT_THEME);
  });

  it('tema parcial é completado com os padrões', () => {
    const c = parseEmailContent({
      theme: { primaryColor: '#ff0000' },
      blocks: [{ type: 'text', text: 'oi' }],
    });
    expect(c.theme.primaryColor).toBe('#ff0000');
    expect(c.theme.textColor).toBe(DEFAULT_THEME.textColor);
  });

  it('recusa cor que não é hexadecimal', () => {
    expect(() =>
      parseEmailContent({ theme: { primaryColor: 'vermelho' }, blocks: [{ type: 'text', text: 'oi' }] }),
    ).toThrow(/primaryColor/);
  });

  it('recusa fontFamily desconhecida', () => {
    expect(() =>
      parseEmailContent({ theme: { fontFamily: 'comic' }, blocks: [{ type: 'text', text: 'oi' }] }),
    ).toThrow(/fontFamily/);
  });
});

describe('parseEmailContent — estilo por bloco', () => {
  it('aceita estilo válido', () => {
    const c = bloco({ type: 'text', text: 'oi', style: { color: '#111111', fontSize: 18, align: 'center' } });
    expect(parseEmailContent(c).blocks[0]).toHaveProperty('style.fontSize', 18);
  });

  it('recusa alinhamento inválido', () => {
    expect(() =>
      parseEmailContent(bloco({ type: 'text', text: 'oi', style: { align: 'justificado' } })),
    ).toThrow(/align/);
  });

  it('recusa tamanho de fonte fora da faixa', () => {
    expect(() => parseEmailContent(bloco({ type: 'text', text: 'oi', style: { fontSize: 200 } }))).toThrow(
      /fontSize/,
    );
  });

  it('bloco sem estilo é válido', () => {
    expect(parseEmailContent(bloco({ type: 'text', text: 'oi' })).blocks).toHaveLength(1);
  });
});
