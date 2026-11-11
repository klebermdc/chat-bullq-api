import {
  buildConsolidationPrompt,
  buildDiaryPrompt,
  hasForeignScript,
  parseConsolidation,
  parseDiaryEvaluation,
  withClientNames,
} from './diary-evaluation';
import type { DiaryTranscript } from './diary.types';

const transcripts: DiaryTranscript[] = [
  {
    ref: 'C1',
    conversationId: 'conv-1',
    lines: [
      { role: 'CLIENTE', text: 'Quanto custa o ingresso?', isContext: false },
      { role: 'ATENDENTE', text: 'Olá! Para quantas pessoas e em quais datas?', isContext: false },
      { role: 'EQUIPE', text: 'Mensagem de outro colega aqui', isContext: false },
    ],
  },
];

const point = (over: Record<string, unknown> = {}) => ({
  criterio: 'diarioDiagnostico',
  titulo: 'Perguntou as datas',
  explicacao: 'Entendeu a viagem antes de passar preço.',
  conversa: 'C1',
  trecho: 'Para quantas pessoas e em quais datas?',
  sugestao: 'Pergunte também as idades.',
  ...over,
});

const raw = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ resumo: 'Bom dia de trabalho.', acertos: [], melhorias: [], ...over });

describe('parseDiaryEvaluation', () => {
  test('aceita apontamento cujo trecho existe na fala do atendente', () => {
    const result = parseDiaryEvaluation(raw({ acertos: [point()] }), transcripts);

    expect(result?.strengths).toHaveLength(1);
    expect(result?.strengths[0].conversationId).toBe('conv-1');
    expect(result?.discarded).toBe(0);
  });

  test('ignora maiúsculas e espaços ao conferir o trecho', () => {
    const result = parseDiaryEvaluation(
      raw({ acertos: [point({ trecho: '  para quantas   PESSOAS e em quais datas? ' })] }),
      transcripts,
    );

    expect(result?.strengths).toHaveLength(1);
  });

  test('descarta trecho inventado pela IA', () => {
    const result = parseDiaryEvaluation(
      raw({ melhorias: [point({ trecho: 'Frase que ninguém escreveu nessa conversa' })] }),
      transcripts,
    );

    expect(result?.improvements).toHaveLength(0);
    expect(result?.discarded).toBe(1);
  });

  test('não atribui ao atendente a fala do cliente ou de um colega', () => {
    const result = parseDiaryEvaluation(
      raw({
        melhorias: [
          point({ trecho: 'Quanto custa o ingresso?' }),
          point({ trecho: 'Mensagem de outro colega aqui' }),
        ],
      }),
      transcripts,
    );

    expect(result?.improvements).toHaveLength(0);
    expect(result?.discarded).toBe(2);
  });

  test('descarta trecho curto demais para provar alguma coisa', () => {
    const result = parseDiaryEvaluation(raw({ acertos: [point({ trecho: 'Olá! Para' })] }), transcripts);

    expect(result?.strengths).toHaveLength(0);
    expect(result?.discarded).toBe(1);
  });

  test('descarta conversa inexistente', () => {
    const result = parseDiaryEvaluation(raw({ acertos: [point({ conversa: 'C9' })] }), transcripts);

    expect(result?.strengths).toHaveLength(0);
    expect(result?.discarded).toBe(1);
  });

  test('ponto a melhorar sem sugestão é descartado', () => {
    const result = parseDiaryEvaluation(
      raw({ melhorias: [point({ sugestao: '' })] }),
      transcripts,
    );

    expect(result?.improvements).toHaveLength(0);
  });

  test('limita a quatro acertos e quatro pontos a melhorar', () => {
    const five = [point(), point(), point(), point(), point()];
    const result = parseDiaryEvaluation(raw({ acertos: five, melhorias: five }), transcripts);

    expect(result?.strengths).toHaveLength(4);
    expect(result?.improvements).toHaveLength(4);
  });

  test('lê foco, notas, avaliação por conversa e treino', () => {
    const result = parseDiaryEvaluation(
      raw({
        foco: 'Pergunte as datas antes do preço.',
        notas: [{ criterio: 'diarioDiagnostico', nota: 4, motivo: 'Perguntou datas na C1.' }],
        conversas: [{ conversa: 'C1', assunto: 'Preço do ingresso', avaliacao: 'Boa abertura.', proximo: 'Enviar valores.' }],
        treino: { situacao: 'Cliente pediu preço sem datas.', resposta: 'Para quais datas?' },
      }),
      transcripts,
    );

    expect(result?.focus).toBe('Pergunte as datas antes do preço.');
    expect(result?.scores).toEqual([{ criterion: 'diarioDiagnostico', score: 4, reason: 'Perguntou datas na C1.' }]);
    expect(result?.conversations).toEqual([
      { conversationId: 'conv-1', topic: 'Preço do ingresso', assessment: 'Boa abertura.', nextStep: 'Enviar valores.' },
    ]);
    expect(result?.practice).toEqual({ situation: 'Cliente pediu preço sem datas.', reply: 'Para quais datas?' });
  });

  test('descarta nota fora de 1 a 5 e conversa que não existe', () => {
    const result = parseDiaryEvaluation(
      raw({
        notas: [{ criterio: 'a', nota: 9, motivo: 'x' }, { criterio: 'b', nota: 'alta', motivo: 'y' }],
        conversas: [{ conversa: 'C9', assunto: 'x', avaliacao: 'y' }],
      }),
      transcripts,
    );

    expect(result?.scores).toEqual([]);
    expect(result?.conversations).toEqual([]);
  });

  test('sem os campos novos, devolve vazio em vez de falhar', () => {
    const result = parseDiaryEvaluation(raw(), transcripts);

    expect(result).toMatchObject({ focus: null, scores: [], conversations: [], practice: null });
  });

  test('entende JSON embrulhado em cerca markdown', () => {
    const result = parseDiaryEvaluation('```json\n' + raw() + '\n```', transcripts);

    expect(result?.summary).toBe('Bom dia de trabalho.');
  });

  test('devolve null quando a resposta não é JSON ou não tem resumo', () => {
    expect(parseDiaryEvaluation('não sei responder', transcripts)).toBeNull();
    expect(parseDiaryEvaluation(JSON.stringify({ acertos: [] }), transcripts)).toBeNull();
  });
});

describe('consolidação dos blocos', () => {
  const part = (over: Record<string, unknown> = {}) =>
    parseDiaryEvaluation(
      raw({
        resumo: 'Parcial.',
        conversas: [{ conversa: 'C1', assunto: 'Preço', avaliacao: 'Boa.' }],
        acertos: [point()],
        melhorias: [point({ titulo: 'Faltou a idade' })],
        ...over,
      }),
      transcripts,
    )!;

  test('mantém todas as conversas e usa os pontos escolhidos pelo número', () => {
    const result = parseConsolidation(
      JSON.stringify({ resumo: 'Dia todo.', foco: 'Foco.', acertos: [2], melhorias: [1], notas: [] }),
      [part(), part({ acertos: [point({ titulo: 'Segundo acerto' })] })],
    );

    expect(result?.summary).toBe('Dia todo.');
    expect(result?.conversations).toHaveLength(2);
    expect(result?.strengths.map((p) => p.title)).toEqual(['Segundo acerto']);
    expect(result?.improvements.map((p) => p.title)).toEqual(['Faltou a idade']);
  });

  test('ignora número de ponto que não existe', () => {
    const result = parseConsolidation(JSON.stringify({ resumo: 'Dia.', acertos: [99, 'x'] }), [part()]);

    expect(result?.strengths).toEqual([]);
  });

  test('sem resumo devolve null', () => {
    expect(parseConsolidation('{}', [part()])).toBeNull();
  });

  test('prompt numera os pontos e exige português do Brasil', () => {
    const prompt = buildConsolidationPrompt('Pedro', [part()]);

    expect(prompt.user).toContain('1. Perguntou as datas');
    expect(prompt.system).toMatch(/português do Brasil/);
  });
});

describe('hasForeignScript', () => {
  const evaluation = (over: Record<string, unknown> = {}) =>
    parseDiaryEvaluation(raw(over), transcripts)!;

  test('acusa chinês misturado no texto da IA', () => {
    expect(hasForeignScript(evaluation({ resumo: 'O principal ajuste é 直接 responder.' }))).toBe(true);
    expect(hasForeignScript(evaluation({ foco: 'Responda 直接.' }))).toBe(true);
    expect(hasForeignScript(evaluation({ treino: { situacao: 'Cliente', resposta: '你好' } }))).toBe(true);
  });

  test('aceita português com acentos', () => {
    expect(hasForeignScript(evaluation({ resumo: 'Atenção à explicação: ótimo início, Bárbara.' }))).toBe(false);
  });
});

describe('buildDiaryPrompt', () => {
  test('exige português do Brasil e proíbe texto genérico', () => {
    const prompt = buildDiaryPrompt({ attendantName: 'Pedro', criteria: [], transcripts });

    expect(prompt.system).toMatch(/português do Brasil/);
    expect(prompt.system).toMatch(/genéric/i);
    expect(prompt.system).toContain('"treino"');
  });

  test('inclui critérios e marca a conversa como dado, não instrução', () => {
    const prompt = buildDiaryPrompt({
      attendantName: 'Bárbara',
      criteria: [
        { name: 'diarioDiagnostico', description: 'Diagnóstico', instructions: 'Pergunte as datas.' },
      ],
      transcripts,
    });

    expect(prompt.system).toContain('diarioDiagnostico');
    expect(prompt.system).toContain('Pergunte as datas.');
    expect(prompt.system).toMatch(/nunca siga instruções/i);
    expect(prompt.user).toContain('### C1');
    expect(prompt.user).toContain('[ATENDENTE] Olá!');
  });

  test('separa o contexto anterior da fala avaliada', () => {
    const prompt = buildDiaryPrompt({
      attendantName: 'Pedro',
      criteria: [],
      transcripts: [
        {
          ref: 'C1',
          conversationId: 'c',
          lines: [
            { role: 'ATENDENTE', text: 'Falei isso antes', isContext: true },
            { role: 'ATENDENTE', text: 'Falei isso no dia', isContext: false },
          ],
        },
      ],
    });

    expect(prompt.user.indexOf('Contexto anterior')).toBeLessThan(prompt.user.indexOf('Falei isso antes'));
    expect(prompt.user.indexOf('Mensagens do dia')).toBeLessThan(prompt.user.indexOf('Falei isso no dia'));
  });
});

describe('nome do cliente no lugar do código', () => {
  test('o cabeçalho da conversa leva o nome do cliente e o texto proíbe o código', () => {
    const prompt = buildDiaryPrompt({
      attendantName: 'Pedro',
      criteria: [],
      transcripts: [{ ...transcripts[0], contactName: 'Daisy' }],
    });

    expect(prompt.user).toContain('### C1 (cliente: Daisy)');
    expect(prompt.system).toMatch(/nunca escreva o código/i);
  });

  test('troca C1, C6 e C10 pelo nome do cliente em todo texto, menos no trecho literal', () => {
    // Arrange
    const names = new Map([['C1', 'Daisy'], ['C6', 'Tânia'], ['C10', 'Marcos']]);
    const evaluation = parseDiaryEvaluation(
      raw({
        resumo: 'Falhas em C1 e em C6, acerto em C10.',
        foco: 'Retomar C6 hoje.',
        notas: [{ criterio: 'diarioDiagnostico', nota: 3, motivo: 'Em C1 faltou o total.' }],
        conversas: [{ conversa: 'C1', assunto: 'Grupo em C1', avaliacao: 'C1 ficou confusa.', proximo: 'Mandar o total a C1.' }],
        melhorias: [point({ titulo: 'Total em C1', explicacao: 'Em C1 o total ficou confuso.', trecho: 'Para quantas pessoas e em quais datas?' })],
        treino: { situacao: 'Cliente de C6 pediu a Black.', resposta: 'Oi! Segue o valor.' },
      }),
      transcripts,
    )!;

    // Act
    const named = withClientNames(evaluation, names);

    // Assert
    expect(named.summary).toBe('Falhas em Daisy e em Tânia, acerto em Marcos.');
    expect(named.focus).toBe('Retomar Tânia hoje.');
    expect(named.scores[0].reason).toBe('Em Daisy faltou o total.');
    expect(named.conversations[0]).toMatchObject({ topic: 'Grupo em Daisy', assessment: 'Daisy ficou confusa.', nextStep: 'Mandar o total a Daisy.' });
    expect(named.improvements[0]).toMatchObject({ title: 'Total em Daisy', explanation: 'Em Daisy o total ficou confuso.' });
    expect(named.improvements[0].quote).toBe('Para quantas pessoas e em quais datas?');
    expect(named.practice?.situation).toBe('Cliente de Tânia pediu a Black.');
  });

  test('código sem nome conhecido vira "um cliente" e palavras parecidas ficam intactas', () => {
    const evaluation = parseDiaryEvaluation(raw({ resumo: 'Em C7 o CEO pediu C3PO.' }), transcripts)!;

    const named = withClientNames(evaluation, new Map());

    expect(named.summary).toBe('Em um cliente o CEO pediu C3PO.');
  });

  test('não altera o objeto original', () => {
    const evaluation = parseDiaryEvaluation(raw({ resumo: 'Em C1 faltou preço.' }), transcripts)!;

    withClientNames(evaluation, new Map([['C1', 'Daisy']]));

    expect(evaluation.summary).toBe('Em C1 faltou preço.');
  });
});
