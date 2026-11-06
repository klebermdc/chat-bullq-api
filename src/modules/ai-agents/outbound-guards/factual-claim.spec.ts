// Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
import {
  LIMIAR_AFIRMACAO,
  LIMIAR_CONTRADICAO,
  LIMIAR_SUPORTE,
  decidirAfirmacoes,
  frasesParaConferir,
  perguntasDaAfirmacao,
  temBaseNumerica,
} from './factual-claim';

describe('frases que saem por regra simples, antes da chamada', () => {
  it('saudação e pergunta não viram frase', () => {
    expect(frasesParaConferir('Bom dia! Como posso ajudar?')).toEqual([]);
    expect(frasesParaConferir('Olá, tudo bem?')).toEqual([]);
    expect(frasesParaConferir('Obrigado!')).toEqual([]);
  });

  it('um link é uma frase só', () => {
    expect(frasesParaConferir('Veja em https://exemplo.com/a.b.c.')).toEqual([
      'Veja em https://exemplo.com/a.b.c.',
    ]);
    expect(frasesParaConferir('https://pousada.example/reservas')).toEqual([]);
  });

  it('a resposta comum vira frase por frase', () => {
    expect(
      frasesParaConferir('O check-in é a partir das 12h. Temos sim piscina aquecida!'),
    ).toEqual(['O check-in é a partir das 12h.', 'Temos sim piscina aquecida!']);
  });

  it('marcador de lista sai da frase', () => {
    expect(frasesParaConferir('- Magic Kingdom abre às 9h\n- Epcot abre às 10h')).toEqual([
      'Magic Kingdom abre às 9h',
      'Epcot abre às 10h',
    ]);
  });
});

describe('as perguntas — três por frase', () => {
  it('claim_i, supported_i e contradicts_i, na ordem das frases', () => {
    const perguntas = perguntasDaAfirmacao(['Abrimos às 8h.', 'Temos piscina.']);
    expect(Object.keys(perguntas)).toEqual([
      'claim_0',
      'supported_0',
      'contradicts_0',
      'claim_1',
      'supported_1',
      'contradicts_1',
    ]);
    expect(perguntas.claim_0).toContain('Abrimos às 8h.');
    expect(perguntas.supported_0).toMatch(/qualquer redação ou formato/);
  });
});

describe('decisão em código, pelo máximo das frases', () => {
  it('contradicts acima do corte é contradiz; claim alto com supported baixo é fora da base', () => {
    expect(
      decidirAfirmacoes(['A.'], { claim_0: 0.9, supported_0: 0.9, contradicts_0: 0.95 }).veredito,
    ).toBe('contradiz');
    expect(
      decidirAfirmacoes(['A.'], { claim_0: 0.95, supported_0: 0.05, contradicts_0: 0.1 }).veredito,
    ).toBe('nao_esta_na_base');
  });

  it('nos cortes exatos tudo passa (">" e "<")', () => {
    expect(LIMIAR_AFIRMACAO).toBe(0.7);
    expect(LIMIAR_SUPORTE).toBe(0.3);
    expect(LIMIAR_CONTRADICAO).toBe(0.7);
    expect(
      decidirAfirmacoes(['A.'], { claim_0: 0.7, supported_0: 0.3, contradicts_0: 0.7 }).veredito,
    ).toBe('passa');
  });

  it('uma frase ruim decide a resposta inteira — o máximo, não a média', () => {
    const r = decidirAfirmacoes(['Está tudo certo.', 'Temos sim piscina aquecida!'], {
      claim_0: 0.9,
      supported_0: 0.9,
      contradicts_0: 0.05,
      claim_1: 0.95,
      supported_1: 0.05,
      contradicts_1: 0.1,
    });
    expect(r.veredito).toBe('nao_esta_na_base');
    expect(r.frase).toBe('Temos sim piscina aquecida!');
  });

  it('contradiz pesa mais que fora da base', () => {
    const r = decidirAfirmacoes(['A.', 'B.'], {
      claim_0: 0.95,
      supported_0: 0.05,
      contradicts_0: 0.1,
      claim_1: 0.9,
      supported_1: 0.9,
      contradicts_1: 0.9,
    });
    expect(r.veredito).toBe('contradiz');
    expect(r.frase).toBe('B.');
  });

  it('afirmação baixa (slogan) passa', () => {
    expect(
      decidirAfirmacoes(['Nosso atendimento é rápido.'], {
        claim_0: 0.2,
        supported_0: 0.4,
        contradicts_0: 0.05,
      }).veredito,
    ).toBe('passa');
  });

  it('nota ausente ou fora de 0–1 é ilegível, nunca um veredito', () => {
    expect(decidirAfirmacoes(['A.'], { claim_0: 0.9 }).ilegivel).toBe(true);
    expect(
      decidirAfirmacoes(['A.'], { claim_0: 1.5, supported_0: 0.5, contradicts_0: 0.1 }).ilegivel,
    ).toBe(true);
  });
});

describe('temBaseNumerica — paráfrase com o preço na evidência', () => {
  const EVIDENCIA =
    'Películas iPhone 17 Pro Max\n- Películas iPhone 17 Pro Max: 3D R$ 79,90 · Flexível R$ 119,90 · Fosca R$ 119,90 · Privace R$ 159,90';

  it.each([
    'Flexível ou fosca: R$ 119,90',
    'Flexível ou fosca: 119.90',
    'Flexível ou fosca: 119,90',
    'Flexível ou fosca: R$ 119.90',
  ])('preço normalizado com item provado passa: %s', (frase) => {
    expect(temBaseNumerica(frase, EVIDENCIA)).toBe(true);
  });

  it.each([
    'Flexível ou fosca: R$ 899,90',
    'Flexível ou privace: R$ 119,90',
    '3D: R$ 119,90',
    'Sai por R$ 119,90',
    'Tem 17% de desconto',
    'Flexível sai por R$ 119,90 e tem frete grátis',
    'Flexível: R$ 1.199,00',
    'Flexível: R$ 11,99',
    'Flexível em 12x de R$ 9,99',
    'Temos sim, piscina aquecida!',
  ])('sem prova mecânica não passa: %s', (frase) => {
    expect(temBaseNumerica(frase, EVIDENCIA)).toBe(false);
  });

  it('decidirAfirmacoes resgata o fora da base só com a prova mecânica', () => {
    const nega = { claim_0: 0.95, supported_0: 0.1, contradicts_0: 0.05 };
    expect(decidirAfirmacoes(['Flexível ou fosca: R$ 119,90'], nega, EVIDENCIA).veredito).toBe('passa');
    expect(decidirAfirmacoes(['Flexível ou fosca: R$ 899,90'], nega, EVIDENCIA).veredito).toBe(
      'nao_esta_na_base',
    );
  });
});
