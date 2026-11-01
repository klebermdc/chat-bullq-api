import { buildDiaryPrompt, parseDiaryEvaluation } from './diary-evaluation';
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

  test('limita a dois acertos e dois pontos a melhorar', () => {
    const result = parseDiaryEvaluation(
      raw({ acertos: [point(), point(), point()], melhorias: [point(), point(), point()] }),
      transcripts,
    );

    expect(result?.strengths).toHaveLength(2);
    expect(result?.improvements).toHaveLength(2);
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

describe('buildDiaryPrompt', () => {
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
