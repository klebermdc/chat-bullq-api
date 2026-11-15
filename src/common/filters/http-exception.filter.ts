import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { Response, Request } from 'express';
import { ERROR_CODES } from '../../modules/error-reporter/error-codes';
import { ErrorReporterService } from '../../modules/error-reporter/error-reporter.service';

/**
 * O segmento depois destes prefixos é um token público: único fator de acesso
 * ao contrato (aceite) ou à cotação por link.
 */
const SENSITIVE_SEGMENT = /(\/public\/contracts\/|\/aceitar\/|\/public\/quotes\/|\/cotacao\/)[^/?#]+/g;

/** URL sem o token público (contrato ou cotação), para log, error-reporter e resposta. */
export function maskSensitivePath(url: string): string {
  return (url ?? '').replace(SENSITIVE_SEGMENT, '$1:token');
}

/** Repassa `missing: string[]` de uma HttpException 4xx; nada mais do corpo. */
function missingFields(res: unknown): { missing?: string[] } {
  if (!res || typeof res !== 'object') return {};
  const missing = (res as { missing?: unknown }).missing;
  return Array.isArray(missing) && missing.every((m) => typeof m === 'string')
    ? { missing }
    : {};
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /**
   * O reporter é opcional porque o filtro é instanciado com `new` no
   * `main.ts` e nos testes. Sem ele o filtro degrada para o comportamento
   * antigo (só log) — a resposta ao cliente nunca depende da coleta.
   */
  constructor(private readonly reporter?: ErrorReporterService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const safeUrl = maskSensitivePath(request.url);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as Record<string, unknown>).message || 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${safeUrl} ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );

      // Só ≥500 vira issue. 4xx é erro de cliente (validação, não achou,
      // sem permissão) e encheria o painel de ruído.
      try {
        const req = request as Request & {
          user?: { id?: string };
          organizationId?: string;
        };
        this.reporter?.report({
          source: ErrorSource.API,
          code: ERROR_CODES.UNHANDLED_HTTP,
          severity: ErrorSeverity.CRITICAL,
          message:
            exception instanceof Error
              ? exception.message
              : String(typeof message === 'string' ? message : 'erro'),
          stack: exception instanceof Error ? exception.stack : undefined,
          context: {
            method: request.method,
            url: safeUrl,
            statusCode: status,
          },
          organizationId: req.organizationId,
          userId: req.user?.id,
        });
      } catch (err) {
        // A resposta ao cliente NUNCA pode depender da coleta de erro.
        this.logger.error(
          `error-reporter falhou dentro do filtro: ${(err as Error).message}`,
        );
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      error:
        exception instanceof HttpException
          ? exception.name
          : 'InternalServerError',
      // Lista de campos faltantes (ex.: contrato com `[Campo]` sem valor) —
      // a tela precisa dela para marcar o que falta, não só o texto.
      ...missingFields(exceptionResponse),
      timestamp: new Date().toISOString(),
      path: safeUrl,
    });
  }
}
