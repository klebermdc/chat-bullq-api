import type { Prisma } from '@prisma/client';

export const CONTRACT_STATUS_FILTERS = ['pending', 'accepted', 'paid', 'purchased', 'invoiced'] as const;
export type ContractStatusFilter = (typeof CONTRACT_STATUS_FILTERS)[number];
export type ContractStatus = 'pending' | 'accepted' | 'paid' | 'invoiced';

interface StatusFields {
  acceptedAt: Date | null;
  paid: boolean;
  paymentReceiptKey: string | null;
  invoiceIssued: boolean;
}

/** Prioridade do faturamento do Lovable: NF > pago > aceito > pendente. */
export function deriveStatus(c: StatusFields): ContractStatus {
  if (c.invoiceIssued) return 'invoiced';
  if (c.paid || c.paymentReceiptKey) return 'paid';
  if (c.acceptedAt) return 'accepted';
  return 'pending';
}

export function statusWhere(filter: ContractStatusFilter): Prisma.ContractWhereInput {
  switch (filter) {
    case 'pending':
      return { acceptedAt: null };
    case 'accepted':
      return { acceptedAt: { not: null } };
    case 'paid':
      return { OR: [{ paid: true }, { paymentReceiptKey: { not: null } }] };
    case 'purchased':
      return { purchased: true };
    case 'invoiced':
      return { invoiceIssued: true };
  }
}
