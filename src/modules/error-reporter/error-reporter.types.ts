import { ErrorSeverity, ErrorSource } from '@prisma/client';

export interface ErrorReportInput {
  source: ErrorSource;
  /** Código estável do catálogo em `error-codes.ts`. Nunca string solta. */
  code: string;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  /** Qualquer dado que ajude a diagnosticar. Não colocar segredo aqui. */
  context?: Record<string, unknown>;
  organizationId?: string;
  channelId?: string;
  conversationId?: string;
  contactId?: string;
  userId?: string;
}

/** Como o issue chegou nesse alerta. Muda a regra de cooldown e o texto. */
export type AlertKind = 'new' | 'regression' | 'recurring';
