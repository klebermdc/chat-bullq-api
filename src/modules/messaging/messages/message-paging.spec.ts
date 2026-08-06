import { clampPageSize, MAX_PAGE_SIZE } from './message-paging';

describe('clampPageSize', () => {
  it('usa o padrão quando o parâmetro não vem', () => {
    expect(clampPageSize(undefined, 50)).toBe(50);
  });

  it('usa o padrão quando o parâmetro não é número', () => {
    expect(clampPageSize('abc', 50)).toBe(50);
  });

  it('respeita o valor pedido', () => {
    expect(clampPageSize('30', 50)).toBe(30);
  });

  // Sem teto, `?limit=100000` puxaria a conversa inteira numa tacada e
  // derrubaria a resposta junto.
  it('corta no teto', () => {
    expect(clampPageSize('100000', 50)).toBe(MAX_PAGE_SIZE);
  });

  it('cai no padrão para valores nulos ou negativos', () => {
    expect(clampPageSize('0', 50)).toBe(50);
    expect(clampPageSize('-10', 50)).toBe(50);
  });
});
