import { Prisma } from '@prisma/client';

/** Conversa que não é de cliente oculto: entra em placar, Diário e Gerente. */
export const REAL_CONVERSATION = {
  contact: { isMysteryShopper: false },
} as const satisfies Prisma.ConversationWhereInput;

/** Fragmento SQL dentro de um WHERE sobre `contacts`, sem alias. */
export const NOT_MYSTERY_SHOPPER_CONTACT = Prisma.sql`"is_mystery_shopper" = false`;
