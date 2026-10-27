import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { ErrorReporterService } from '../../modules/error-reporter/error-reporter.service';
import { GlobalExceptionFilter, maskSensitivePath } from './http-exception.filter';

function makeHost(url = '/api/v1/conversations', method = 'GET'): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        url,
        method,
        user: { id: 'usr_1' },
        organizationId: 'org_1',
      }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  let reporter: { report: jest.Mock };
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    reporter = { report: jest.fn() };
    filter = new GlobalExceptionFilter(
      reporter as unknown as ErrorReporterService,
    );
  });

  it('reporta erro 500', () => {
    const { host } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ErrorSource.API,
        code: 'UNHANDLED_HTTP',
        severity: ErrorSeverity.CRITICAL,
        organizationId: 'org_1',
        userId: 'usr_1',
      }),
    );
  });

  it('NAO reporta 4xx — erro de cliente nao e bug nosso', () => {
    const { host } = makeHost();
    filter.catch(
      new HttpException('nao encontrado', HttpStatus.NOT_FOUND),
      host,
    );
    expect(reporter.report).not.toHaveBeenCalled();
  });

  it('guarda rota e metodo no contexto', () => {
    const { host } = makeHost('/api/v1/messages', 'POST');
    filter.catch(new Error('boom'), host);
    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          method: 'POST',
          url: '/api/v1/messages',
          statusCode: 500,
        }),
      }),
    );
  });

  it('continua respondendo ao cliente mesmo sem reporter', () => {
    const semReporter = new GlobalExceptionFilter();
    const { host, status, json } = makeHost();
    semReporter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalled();
  });

  it('responde ao cliente mesmo se o report explodir', () => {
    reporter.report.mockImplementation(() => {
      throw new Error('reporter quebrado');
    });
    const { host, status, json } = makeHost();
    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalled();
  });

  it('mascara o token do contrato público no log, no reporter e no path da resposta', () => {
    const errorSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);
    const { host, json } = makeHost('/api/v1/public/contracts/abc123SEGREDO/pdf');
    filter.catch(new Error('boom'), host);
    expect(errorSpy.mock.calls[0][0]).toBe('GET /api/v1/public/contracts/:token/pdf 500');
    expect(JSON.stringify(reporter.report.mock.calls)).not.toContain('abc123SEGREDO');
    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ url: '/api/v1/public/contracts/:token/pdf' }) }),
    );
    expect(json.mock.calls[0][0].path).toBe('/api/v1/public/contracts/:token/pdf');
  });

  it('mascara o token também em respostas 4xx', () => {
    const { host, json } = makeHost('/api/v1/public/contracts/abc123SEGREDO');
    filter.catch(new HttpException('nao encontrado', HttpStatus.NOT_FOUND), host);
    expect(json.mock.calls[0][0].path).toBe('/api/v1/public/contracts/:token');
  });
});

describe('maskSensitivePath', () => {
  it('troca o segmento depois de /public/contracts/ e /aceitar/ por :token', () => {
    expect(maskSensitivePath('/api/v1/public/contracts/abc123/pdf')).toBe('/api/v1/public/contracts/:token/pdf');
    expect(maskSensitivePath('/api/v1/public/contracts/abc123')).toBe('/api/v1/public/contracts/:token');
    expect(maskSensitivePath('/api/v1/public/contracts/abc123/accept?x=1')).toBe('/api/v1/public/contracts/:token/accept?x=1');
    expect(maskSensitivePath('/aceitar/abc123')).toBe('/aceitar/:token');
    expect(maskSensitivePath('/contratos/aceitar/abc123?utm=1')).toBe('/contratos/aceitar/:token?utm=1');
  });

  it('troca o token da cotação por link (/public/quotes/ e /cotacao/)', () => {
    expect(maskSensitivePath('/api/v1/public/quotes/abc123')).toBe('/api/v1/public/quotes/:token');
    expect(maskSensitivePath('/api/v1/public/quotes/abc123/pdf')).toBe('/api/v1/public/quotes/:token/pdf');
    expect(maskSensitivePath('/api/v1/public/quotes/abc123/view')).toBe('/api/v1/public/quotes/:token/view');
    expect(maskSensitivePath('/cotacao/abc123?utm=1')).toBe('/cotacao/:token?utm=1');
    expect(maskSensitivePath('/api/v1/proposals/conversation/c1')).toBe('/api/v1/proposals/conversation/c1');
  });

  it('não mexe em outras rotas', () => {
    expect(maskSensitivePath('/api/v1/contracts/c1/pdf')).toBe('/api/v1/contracts/c1/pdf');
    expect(maskSensitivePath('/api/v1/public/contracts/')).toBe('/api/v1/public/contracts/');
    expect(maskSensitivePath('')).toBe('');
    expect(maskSensitivePath(undefined as unknown as string)).toBe('');
  });
});
