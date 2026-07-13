import {
  phonesMatch,
  emailsMatch,
  namesSimilar,
  normalizeName,
  scoreOrderAgainstContact,
} from './reconciliation.match';

describe('reconciliation.match — heurística', () => {
  describe('phonesMatch (últimos 8 dígitos)', () => {
    it('casa ignorando DDI e 9º dígito', () => {
      expect(phonesMatch('+55 (11) 98201-5967', '11982015967')).toBe(true);
      expect(phonesMatch('5511982015967', '(11) 8201-5967')).toBe(true);
    });
    it('não casa números diferentes', () => {
      expect(phonesMatch('11982015967', '11999998888')).toBe(false);
    });
    it('não casa quando falta dígito/está vazio', () => {
      expect(phonesMatch('', '11982015967')).toBe(false);
      expect(phonesMatch('123', '123')).toBe(false);
      expect(phonesMatch(null, null)).toBe(false);
    });
  });

  describe('emailsMatch', () => {
    it('casa case-insensitive com trim', () => {
      expect(emailsMatch(' Joao@Email.com ', 'joao@email.com')).toBe(true);
    });
    it('não casa vazio ou diferente', () => {
      expect(emailsMatch('', '')).toBe(false);
      expect(emailsMatch('a@x.com', 'b@x.com')).toBe(false);
    });
  });

  describe('normalizeName / namesSimilar', () => {
    it('remove acento e caixa', () => {
      expect(normalizeName('João Câmara')).toBe('joao camara');
    });
    it('casa nomes iguais (com acento/caixa diferentes)', () => {
      expect(namesSimilar('João Câmara', 'joao camara')).toBe(true);
    });
    it('casa por 2+ tokens em comum (nome+sobrenome)', () => {
      expect(namesSimilar('Maria Silva Souza', 'Maria Souza')).toBe(true);
    });
    it('NÃO casa por um único token comum', () => {
      expect(namesSimilar('Maria Silva', 'Maria Oliveira')).toBe(false);
      expect(namesSimilar('João Silva', 'Pedro Silva')).toBe(false);
    });
  });

  describe('scoreOrderAgainstContact', () => {
    it('soma pesos e lista os motivos (telefone+nome+valor)', () => {
      const r = scoreOrderAgainstContact(
        { telefoneCliente: '11982015967', cliente: 'João Câmara', venda: 4200 },
        { phone: '+55 11 98201-5967', name: 'joao camara' },
        4200,
      );
      expect(r.score).toBe(50 + 20 + 10);
      expect(r.reasons).toEqual(['telefone', 'nome', 'valor']);
    });
    it('email forte casa sozinho', () => {
      const r = scoreOrderAgainstContact(
        { emailCliente: 'a@x.com' },
        { email: 'A@X.com' },
      );
      expect(r.score).toBe(40);
      expect(r.reasons).toEqual(['email']);
    });
    it('nada em comum → score 0', () => {
      const r = scoreOrderAgainstContact(
        { telefoneCliente: '11111111111', cliente: 'Ana', emailCliente: 'a@a.com' },
        { phone: '22222222222', name: 'Bruno', email: 'b@b.com' },
      );
      expect(r.score).toBe(0);
      expect(r.reasons).toEqual([]);
    });
    it('valor só conta se bater exato (tolerância de centavos)', () => {
      const base = { telefoneCliente: null, cliente: null };
      expect(scoreOrderAgainstContact({ ...base, venda: 100 }, {}, 100).score).toBe(10);
      expect(scoreOrderAgainstContact({ ...base, venda: 100 }, {}, 101).score).toBe(0);
    });
  });
});
