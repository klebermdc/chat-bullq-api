import {
  buildSnippet,
  escapeLikeTerm,
  messageText,
  SNIPPET_RADIUS,
} from './message-search';

describe('messageText', () => {
  it('lê o texto da mensagem', () => {
    expect(messageText({ text: 'oi' })).toBe('oi');
  });

  it('cai na legenda quando a mensagem é mídia sem texto', () => {
    expect(messageText({ mediaUrl: 'x', caption: 'voucher' })).toBe('voucher');
  });

  it('prefere o texto quando os dois existem', () => {
    expect(messageText({ text: 'oi', caption: 'voucher' })).toBe('oi');
  });

  it('devolve vazio para conteúdo sem texto nenhum (áudio, sticker)', () => {
    expect(messageText({ mediaUrl: 'x' })).toBe('');
  });

  it('tolera conteúdo nulo ou não-objeto vindo do banco', () => {
    expect(messageText(null)).toBe('');
    expect(messageText('texto solto')).toBe('');
  });
});

describe('escapeLikeTerm', () => {
  // Sem escape, um "%" digitado vira coringa e a busca casa a conversa
  // inteira — o usuário pediu um caractere, não um curinga.
  it('escapa o coringa % para ele valer como caractere', () => {
    expect(escapeLikeTerm('50%')).toBe('50\\%');
  });

  it('escapa o coringa _ ', () => {
    expect(escapeLikeTerm('nome_do_arquivo')).toBe('nome\\_do\\_arquivo');
  });

  it('escapa a própria barra invertida antes dos coringas', () => {
    expect(escapeLikeTerm('a\\b')).toBe('a\\\\b');
  });

  it('deixa texto comum intacto', () => {
    expect(escapeLikeTerm('Disney julho')).toBe('Disney julho');
  });
});

describe('buildSnippet', () => {
  it('devolve o texto inteiro quando ele já cabe no trecho', () => {
    expect(buildSnippet('quero ir pra Disney', 'Disney')).toBe(
      'quero ir pra Disney',
    );
  });

  it('centra o trecho no termo encontrado', () => {
    const long = `${'a'.repeat(200)} Disney ${'b'.repeat(200)}`;

    const snippet = buildSnippet(long, 'Disney');

    expect(snippet).toContain('Disney');
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_RADIUS * 2 + 'Disney'.length + 10);
  });

  it('marca com reticências que o trecho foi cortado dos dois lados', () => {
    const long = `${'a'.repeat(200)} Disney ${'b'.repeat(200)}`;

    const snippet = buildSnippet(long, 'Disney');

    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('não corta o começo quando o termo está no início', () => {
    const long = `Disney ${'b'.repeat(300)}`;

    expect(buildSnippet(long, 'Disney').startsWith('Disney')).toBe(true);
  });

  it('acha o termo sem diferenciar maiúscula, como a busca faz', () => {
    const long = `${'a'.repeat(200)} DISNEY ${'b'.repeat(200)}`;

    expect(buildSnippet(long, 'disney')).toContain('DISNEY');
  });

  it('cai no começo do texto quando o termo não aparece (mídia sem legenda)', () => {
    const long = 'c'.repeat(300);

    const snippet = buildSnippet(long, 'Disney');

    expect(snippet.startsWith('ccc')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('tolera texto vazio', () => {
    expect(buildSnippet('', 'Disney')).toBe('');
  });
});
