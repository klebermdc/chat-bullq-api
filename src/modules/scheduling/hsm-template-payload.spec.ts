import { buildHsmTemplateContent } from './hsm-template-payload';

const template = (text: string, extra: Record<string, unknown> = {}) => ({
  name: 'distribuicao_vendedor',
  language: 'pt_BR',
  components: { body: { text } },
  variableExamples: {},
  ...extra,
});

describe('buildHsmTemplateContent', () => {
  it('preenche {{1}} com o primeiro nome do contato', () => {
    const out = buildHsmTemplateContent(template('Oi {{1}}!'), 'Maria Souza');
    expect(out).toEqual({
      name: 'distribuicao_vendedor',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }] }],
    });
  });

  it('usa os valores informados para as demais variáveis', () => {
    const out = buildHsmTemplateContent(
      template('Oi {{1}}, aqui é {{2}}.'),
      'Maria Souza',
      { '2': 'Bárbara' },
    );
    expect(out?.components[0].parameters).toEqual([
      { type: 'text', text: 'Maria' },
      { type: 'text', text: 'Bárbara' },
    ]);
  });

  it('cai no exemplo cadastrado quando a variável não foi informada', () => {
    const out = buildHsmTemplateContent(
      template('Oi {{1}}, {{2}} {{3}}', { variableExamples: { '3': 'OFP' } }),
      null,
      { '2': 'Bárbara' },
    );
    expect(out?.components[0].parameters.map((p: any) => p.text)).toEqual([
      '-',
      'Bárbara',
      'OFP',
    ]);
  });

  it('não monta template com cabeçalho de mídia', () => {
    const out = buildHsmTemplateContent(
      template('Oi {{1}}', { components: { header: { format: 'IMAGE' }, body: { text: 'x' } } }),
      'Maria',
    );
    expect(out).toBeNull();
  });
});
