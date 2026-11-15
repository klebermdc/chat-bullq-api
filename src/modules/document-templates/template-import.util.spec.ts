import { MAX_TEMPLATES_PER_FILE, parseImportFile } from './template-import.util';
import { MAX_BODY_LENGTH } from './dto/document-template.dto';

const ok = { sourceRef: 'drive-1', title: ' Contrato ', category: 'Viagem', audience: 'CLIENT', body: '  Eu, [Nome do Cliente]\n' };

describe('parseImportFile', () => {
  it('aceita arquivo válido, apara título e mantém o corpo como veio', () => {
    const { templates, errors } = parseImportFile({ templates: [ok] });
    expect(errors).toEqual([]);
    expect(templates).toEqual([{ sourceRef: 'drive-1', title: 'Contrato', category: 'Viagem', audience: 'CLIENT', body: '  Eu, [Nome do Cliente]\n' }]);
  });

  it('recusa arquivo sem a lista', () => {
    expect(parseImportFile({}).errors).toHaveLength(1);
    expect(parseImportFile(null).errors).toHaveLength(1);
  });

  it('aponta os campos inválidos por índice sem citar o corpo', () => {
    const { templates, errors } = parseImportFile({ templates: [ok, { ...ok, sourceRef: 'x', audience: 'PUBLIC', body: 'SEGREDO'.repeat(MAX_BODY_LENGTH) }] });
    expect(templates).toHaveLength(1);
    expect(errors.join('\n')).toContain('templates[1]');
    expect(errors.join('\n')).toContain('audience');
    expect(errors.join('\n')).toContain('body');
    expect(errors.join('\n')).not.toContain('SEGREDO');
  });

  it('corpo com mais de 200 campos é erro', () => {
    const body = Array.from({ length: 201 }, (_, i) => `[C${i}]`).join(' ');
    expect(parseImportFile({ templates: [{ ...ok, body }] }).errors[0]).toContain('mais de 200 campos');
  });

  it('item que não é objeto vira erro', () => {
    expect(parseImportFile({ templates: ['x'] }).errors[0]).toContain('templates[0]');
  });

  it('sourceRef repetido é erro', () => {
    expect(parseImportFile({ templates: [ok, ok] }).errors).toEqual(['sourceRef repetido: "drive-1"']);
  });

  it('limita a quantidade de modelos', () => {
    const many = Array.from({ length: MAX_TEMPLATES_PER_FILE + 1 }, (_, i) => ({ ...ok, sourceRef: `d${i}` }));
    expect(parseImportFile({ templates: many }).errors[0]).toContain('mais de');
  });
});
