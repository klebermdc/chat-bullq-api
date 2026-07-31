import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { ErrorReporterService } from '../../modules/error-reporter/error-reporter.service';
import { GlobalExceptionFilter } from './http-exception.filter';

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
});
