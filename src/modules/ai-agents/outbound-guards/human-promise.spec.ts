// Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
import { detectHumanPromise } from './human-promise';

// DEVE detectar: promessa clara de envolver uma pessoa da retaguarda.
const PROMESSAS: readonly string[] = [
  'vou verificar com a equipe',
  'nosso time vai resolver isso',
  'assim que liberarem eu te aviso',
  'vou acionar o responsável',
  'vou encaminhar pro setor responsável',
  'deixa eu falar com o pessoal do suporte',
  'vou passar pro nosso time técnico',
  'um responsável vai te retornar',
  'vou pedir pra equipe liberar',
  'isso quem resolve é o nosso time',
  'já passo o número do pedido para eles resolverem junto com a reativação',
  'sua solicitação sobre garantia está em análise pela equipe responsável',
  'isso está em análise pela nossa equipe',
  'seu caso ficou em análise com o responsável',
];

// NÃO detectar: ação da própria IA, frase institucional, consulta ao sistema.
const NAO_PROMESSAS: readonly string[] = [
  'vou te enviar o link',
  'vou confirmar o valor pra você',
  'deixa eu ver aqui rapidinho',
  'vou preparar seu orçamento',
  'já te mando o boleto',
  'vou verificar seu pedido no sistema',
  'nossa equipe está sempre à disposição',
  'vou anotar aqui',
  'vou passar o recado pra eles mais tarde',
  'sua análise de sangue está pronta',
  'o produto está em análise técnica interna, sem previsão',
];

describe('detectHumanPromise — calibração', () => {
  it.each(PROMESSAS)('detecta promessa de humano: %s', (body) => {
    expect(detectHumanPromise(body)).toBe(true);
  });

  it.each(NAO_PROMESSAS)('não detecta fala legítima: %s', (body) => {
    expect(detectHumanPromise(body)).toBe(false);
  });

  it('é robusto a caixa e acento', () => {
    expect(detectHumanPromise('VOU VERIFICAR COM A EQUIPE')).toBe(true);
    expect(detectHumanPromise('vou acionar o RESPONSAVEL')).toBe(true);
  });

  it('string vazia não é promessa', () => {
    expect(detectHumanPromise('')).toBe(false);
    expect(detectHumanPromise('   ')).toBe(false);
  });
});

describe('detectHumanPromise — vocabulário da Sendtur (consultor, vendedor)', () => {
  it.each([
    'Vou te passar pra um dos nossos consultores',
    'Vou encaminhar seu pedido para a consultora',
    'Vou verificar com o vendedor e te falo',
    'O consultor vai te retornar ainda hoje',
    'A vendedora vai te chamar amanhã',
    'Quem resolve isso é o nosso consultor',
  ])('detecta: %s', (body) => {
    expect(detectHumanPromise(body)).toBe(true);
  });

  it.each([
    'O consultor é especialista em Orlando',
    'Nossos consultores já foram mais de 30 vezes pra Disney',
    'Quer que eu chame um consultor pra você?',
  ])('não detecta: %s', (body) => {
    expect(detectHumanPromise(body)).toBe(false);
  });
});

describe('detectHumanPromise — nomes próprios extras', () => {
  const NOMES = ['falar com humano', 'atendente', 'pessoa real', 'fulano', 'gerente'];

  it('sem nomes extras, "vou confirmar com o Fulano" não é detectada', () => {
    expect(detectHumanPromise('vou confirmar com o Fulano a disponibilidade de segunda')).toBe(false);
  });

  it('com nomes extras, a mesma frase é detectada', () => {
    expect(detectHumanPromise('vou confirmar com o Fulano a disponibilidade de segunda', NOMES)).toBe(true);
    expect(detectHumanPromise('vou encaminhar essa questão ao Fulano', NOMES)).toBe(true);
    expect(detectHumanPromise('vou falar com o FULANO', NOMES)).toBe(true);
  });

  it('palavras compostas não quebram a montagem do regex', () => {
    expect(() => detectHumanPromise('qualquer coisa', NOMES)).not.toThrow();
  });

  it('nome mencionado sem promessa não dispara', () => {
    expect(detectHumanPromise('o Fulano é o nosso gerente de oficina', NOMES)).toBe(false);
  });
});

describe('consentimento para transferência não é operação executada', () => {
  it.each([
    'Você quer que eu te transfira para a equipe verificar?',
    'Posso falar com o responsável para você?',
    'Gostaria de ser encaminhado para o setor?',
    'Quer que eu verifique com a equipe?',
    'Entendi! Quer que eu encaminhe para a equipe verificar?',
    'Certo! Quer que eu fale com o responsável sobre isso?',
    'Ok! Quer que eu chame alguém do time para te ajudar?',
  ])('não exige ação antes: %s', (body) => {
    expect(detectHumanPromise(body)).toBe(false);
  });

  it.each([
    'Já transferi para a equipe. Você quer continuar?',
    'Vou encaminhar para o setor. Você quer?',
    'Quer que eu te transfira? Nossa equipe vai retornar hoje.',
    'Você quer falar com a equipe que já acabei de chamar?',
    'Já acionei o time. Quer que eu encaminhe para a equipe?',
    'Entendi! Já encaminhei para a equipe, tudo bem?',
    'Entendi! Vou anotar aqui. Quer que eu encaminhe para a equipe?',
    'Pode deixar. Quer que eu chame o responsável?',
    'Quer que eu passe para o gerente, que te liga hoje às 15h?',
    'Posso transferir para a equipe? Eles te retornam ainda hoje.',
    'Posso encaminhar para o setor? O responsável retorna em 10 minutos.',
  ])('conserva a promessa: %s', (body) => {
    expect(detectHumanPromise(body)).toBe(true);
  });
});

describe('repasse alegado sem objeto continua promessa', () => {
  it.each([
    'Já encaminhei! Quer que eu peça para a equipe priorizar?',
    'Pronto, encaminhado! Quer que eu avise a equipe?',
    'Já repassei aqui. Quer que eu avise alguém?',
    'Eu já transferi. Posso ajudar em mais alguma coisa?',
  ])('%s', (body) => {
    expect(detectHumanPromise(body)).toBe(true);
  });

  it.each([
    'Já te encaminhei o link do catálogo.',
    'Seu pedido foi encaminhado.',
    'Já te encaminhei! Conseguiu abrir?',
    'Encaminhei o boleto para o seu e-mail.',
  ])('%s', (body) => {
    expect(detectHumanPromise(body)).toBe(false);
  });
});
