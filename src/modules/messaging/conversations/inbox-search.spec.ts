import { buildSearchOr, MIN_PHONE_DIGITS } from './inbox-search';

describe('buildSearchOr', () => {
  const phoneClause = (clauses: any[]) =>
    clauses.find((c) => c.contact?.phone)?.contact?.phone?.contains;
  const nameClause = (clauses: any[]) =>
    clauses.find((c) => c.contact?.name)?.contact?.name?.contains;
  const protocolClause = (clauses: any[]) =>
    clauses.find((c) => c.protocol)?.protocol?.contains;

  it('busca por nome do contato sem diferenciar maiúscula', () => {
    const clauses = buildSearchOr('Maria');

    expect(nameClause(clauses)).toBe('Maria');
    const name = clauses.find((c: any) => c.contact?.name) as any;
    expect(name.contact.name.mode).toBe('insensitive');
  });

  it('busca por protocolo', () => {
    expect(protocolClause(buildSearchOr('A1B2'))).toBe('A1B2');
  });

  // Regressão: o telefone é gravado só em dígitos (normalizePhone →
  // "5511982015967"). Buscar o número com máscara não achava nada, e o lead
  // parecia ter sumido.
  it('casa telefone com máscara contra o telefone gravado em dígitos', () => {
    expect(phoneClause(buildSearchOr('(11) 98201-5967'))).toBe('11982015967');
  });

  it('casa telefone escrito com +55 e espaços', () => {
    expect(phoneClause(buildSearchOr('+55 11 98201 5967'))).toBe(
      '5511982015967',
    );
  });

  it('não gera cláusula de telefone para busca textual pura', () => {
    expect(phoneClause(buildSearchOr('Maria'))).toBeUndefined();
  });

  it(`não gera cláusula de telefone com menos de ${MIN_PHONE_DIGITS} dígitos — casaria com meio banco`, () => {
    expect(phoneClause(buildSearchOr('Ana 2'))).toBeUndefined();
  });

  it('gera cláusula de telefone a partir de MIN_PHONE_DIGITS dígitos', () => {
    expect(phoneClause(buildSearchOr('982'))).toBe('982');
  });

  it('ignora espaço em volta do termo', () => {
    expect(nameClause(buildSearchOr('  Maria  '))).toBe('Maria');
  });

  it('devolve vazio para termo em branco — nada a filtrar', () => {
    expect(buildSearchOr('   ')).toEqual([]);
  });
});
