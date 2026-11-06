import { montarPedidoAoJuiz, lerNotasDoJuiz } from './fact-check-judge';

describe('montarPedidoAoJuiz', () => {
  it('leva as frases, as perguntas e a evidência, e pede JSON estrito', () => {
    const { system, user } = montarPedidoAoJuiz(
      ['O Magic Kingdom abre às 9h.'],
      'Magic Kingdom: abre 9h, fecha 23h',
    );
    expect(system).toMatch(/SOMENTE um objeto JSON/);
    expect(user).toContain('claim_0');
    expect(user).toContain('supported_0');
    expect(user).toContain('contradicts_0');
    expect(user).toContain('O Magic Kingdom abre às 9h.');
    expect(user).toContain('Magic Kingdom: abre 9h, fecha 23h');
  });
});

describe('lerNotasDoJuiz', () => {
  const COMPLETO = '{"claim_0":0.9,"supported_0":0.1,"contradicts_0":0}';

  it('lê o JSON puro', () => {
    expect(lerNotasDoJuiz(COMPLETO, 1)).toEqual({ claim_0: 0.9, supported_0: 0.1, contradicts_0: 0 });
  });

  it('tira raciocínio <think> e cerca de markdown antes de ler', () => {
    const bruto = `<think>vou pensar</think>\n\`\`\`json\n${COMPLETO}\n\`\`\``;
    expect(lerNotasDoJuiz(bruto, 1)).toEqual({ claim_0: 0.9, supported_0: 0.1, contradicts_0: 0 });
  });

  it('acha o objeto no meio de texto solto', () => {
    expect(lerNotasDoJuiz(`Segue: ${COMPLETO} pronto`, 1)).not.toBeNull();
  });

  it('ignora chaves extras e devolve só as pedidas', () => {
    expect(lerNotasDoJuiz('{"claim_0":1,"supported_0":1,"contradicts_0":0,"x":3}', 1)).toEqual({
      claim_0: 1,
      supported_0: 1,
      contradicts_0: 0,
    });
  });

  it.each([
    ['vazio', ''],
    ['não é JSON', 'não sei'],
    ['falta uma nota', '{"claim_0":0.9,"supported_0":0.1}'],
    ['nota fora de 0–1', '{"claim_0":1.2,"supported_0":0.1,"contradicts_0":0}'],
    ['nota em texto', '{"claim_0":"alta","supported_0":0.1,"contradicts_0":0}'],
    ['array no lugar do objeto', '[0.9, 0.1, 0]'],
  ])('resposta inválida vira null (%s)', (_caso, bruto) => {
    expect(lerNotasDoJuiz(bruto, 1)).toBeNull();
  });

  it('exige as três notas de cada frase', () => {
    expect(lerNotasDoJuiz(COMPLETO, 2)).toBeNull();
  });
});
