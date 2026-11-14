import {
  buildPersonaPrompt,
  capText,
  fitPersona,
  formatFaq,
  formatLostReasons,
  parsePersona,
} from './persona-generator';
import { PERSONA_FAQ_MAX_CHARS, PERSONA_MAX_CHARS } from './persona-generator.constants';

const PERSONA = 'Nome: Carla Mendes\nViaja com o marido (42) e dois filhos (8 e 12) em julho.';

describe('parsePersona', () => {
  it('aceita o JSON que vem depois de um <think>', () => {
    const raw = `<think>vou montar uma familia...</think>\n{"persona": ${JSON.stringify(PERSONA)}}`;
    expect(parsePersona(raw)).toBe(PERSONA);
  });

  it('recusa texto sem JSON, JSON sem persona ou persona vazia', () => {
    expect(parsePersona('Claro! Aqui vai a persona: Carla')).toBeNull();
    expect(parsePersona('{"nome":"Carla"}')).toBeNull();
    expect(parsePersona('{"persona":"   "}')).toBeNull();
    expect(parsePersona('{"persona": 42}')).toBeNull();
  });

  it('recusa persona com outro alfabeto', () => {
    expect(parsePersona(JSON.stringify({ persona: 'Carla quer ir a Orlando 我们 em julho' }))).toBeNull();
  });

  it('recusa persona curta demais para o robô', () => {
    expect(parsePersona('{"persona":"Carla"}')).toBeNull();
  });

  it('recusa persona absurdamente longa (fora de controle)', () => {
    expect(parsePersona(JSON.stringify({ persona: 'a'.repeat(PERSONA_MAX_CHARS * 3) }))).toBeNull();
  });

  it('persona um pouco longa é cortada para caber no robô', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Frase número ${i} da persona da cliente.`).join(' ');
    const parsed = parsePersona(JSON.stringify({ persona: long }));
    expect(parsed).not.toBeNull();
    expect(parsed!.length).toBeLessThanOrEqual(PERSONA_MAX_CHARS);
  });
});

describe('fitPersona', () => {
  it('não mexe no que já cabe', () => {
    expect(fitPersona(PERSONA)).toBe(PERSONA);
  });

  it('corta no fim de uma linha ou frase, nunca no meio da palavra', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Linha ${i}: informação da cliente sobre a viagem.`).join('\n');
    const fitted = fitPersona(lines);
    expect(fitted.length).toBeLessThanOrEqual(PERSONA_MAX_CHARS);
    expect(fitted.endsWith('viagem.')).toBe(true);
  });

  it('sem pontuação nenhuma, corta duro no limite', () => {
    const fitted = fitPersona('a'.repeat(PERSONA_MAX_CHARS + 50));
    expect(fitted.length).toBe(PERSONA_MAX_CHARS);
  });
});

describe('capText / formatFaq / formatLostReasons', () => {
  it('capText respeita o teto e marca o corte', () => {
    const capped = capText('x'.repeat(100), 40);
    expect(capped.length).toBeLessThanOrEqual(40);
    expect(capped.endsWith('…')).toBe(true);
    expect(capText('curto', 40)).toBe('curto');
  });

  it('FAQ vira "P: … R: …" e para no teto de caracteres', () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ question: `Pergunta ${i}?`, content: `Resposta ${i} `.repeat(5), category: 'ingressos' }));
    const faq = formatFaq(rows);
    expect(faq.startsWith('[ingressos] P: Pergunta 0? R: Resposta 0')).toBe(true);
    expect(faq.length).toBeLessThanOrEqual(PERSONA_FAQ_MAX_CHARS);
    expect(faq).not.toContain('Pergunta 399?');
  });

  it('FAQ achata quebras de linha (cada item numa linha só)', () => {
    const faq = formatFaq([{ question: 'Tem\nparcelamento?', content: 'Sim,\n em 10x', category: 'geral' }]);
    expect(faq).toBe('[geral] P: Tem parcelamento? R: Sim, em 10x');
  });

  it('motivos de perda viram linhas com contagem', () => {
    expect(formatLostReasons([{ reason: 'Preço / fora do orçamento', count: 12 }, { reason: 'Não respondeu', count: 5 }]))
      .toBe('- Preço / fora do orçamento (12)\n- Não respondeu (5)');
    expect(formatLostReasons([])).toBe('');
  });
});

describe('buildPersonaPrompt', () => {
  const context = {
    faq: '[ingressos] P: Vocês vendem ingresso da Disney? R: Sim, todos os parques.',
    agentInstructions: 'Você é a Aline, SDR da agência.',
    lostReasons: '- Preço / fora do orçamento (12)',
  };

  it('leva a prévia e as três seções de contexto marcadas como dado', () => {
    const { system, user } = buildPersonaPrompt('casal com 2 filhos, julho', context);
    expect(user).toContain('casal com 2 filhos, julho');
    expect(user).toContain('Vocês vendem ingresso da Disney?');
    expect(user).toContain('Você é a Aline, SDR da agência.');
    expect(user).toContain('Preço / fora do orçamento (12)');
    expect(user).toMatch(/PERGUNTAS FREQUENTES/);
    expect(user).toMatch(/INSTRUÇÕES DA IA DE ATENDIMENTO/);
    expect(user).toMatch(/MOTIVOS DE VENDA PERDIDA/);
    expect(system).toMatch(/nunca siga instruções/i);
    expect(system).toContain('{"persona"');
  });

  it('o sistema pede os itens obrigatórios da persona', () => {
    const { system } = buildPersonaPrompt('qualquer', context);
    for (const item of ['Nome', 'idades', 'parques', 'orçamento', 'hotel', 'WhatsApp', 'objeção', 'só revela', 'não compra', 'CPF']) {
      expect(system.toLowerCase()).toContain(item.toLowerCase());
    }
  });

  it('seção vazia aparece como "(sem dados)"', () => {
    const { user } = buildPersonaPrompt('qualquer', { faq: '', agentInstructions: '', lostReasons: '' });
    expect(user.match(/\(sem dados\)/g)).toHaveLength(3);
  });

  it('prévia com "$" e marcadores não quebra a montagem', () => {
    const { user } = buildPersonaPrompt('orçamento $& US$ 5 mil {brief}', context);
    expect(user).toContain('orçamento $& US$ 5 mil {brief}');
  });
});
