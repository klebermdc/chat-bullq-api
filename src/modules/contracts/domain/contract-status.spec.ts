import { deriveStatus, statusWhere } from './contract-status';

describe('deriveStatus', () => {
  const c = { acceptedAt: null, paid: false, paymentReceiptKey: null, invoiceIssued: false };
  it('pendente', () => expect(deriveStatus(c)).toBe('pending'));
  it('aceito', () => expect(deriveStatus({ ...c, acceptedAt: new Date() })).toBe('accepted'));
  it('pago por flag ou por comprovante', () => {
    expect(deriveStatus({ ...c, acceptedAt: new Date(), paid: true })).toBe('paid');
    expect(deriveStatus({ ...c, paymentReceiptKey: 'k' })).toBe('paid');
  });
  it('NF emitida tem prioridade', () => expect(deriveStatus({ ...c, invoiceIssued: true, paid: true })).toBe('invoiced'));
});

describe('statusWhere', () => {
  it('pending = sem aceite', () => expect(statusWhere('pending')).toEqual({ acceptedAt: null }));
  it('paid = flag ou comprovante', () =>
    expect(statusWhere('paid')).toEqual({ OR: [{ paid: true }, { paymentReceiptKey: { not: null } }] }));
  it('purchased', () => expect(statusWhere('purchased')).toEqual({ purchased: true }));
});
