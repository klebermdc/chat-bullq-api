import { ConfigService } from '@nestjs/config';
import {
  ErrorIssue,
  ErrorIssueStatus,
  ErrorSeverity,
  ErrorSource,
} from '@prisma/client';
import axios from 'axios';
import { ErrorAlertService } from './error-alert.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const NOW = new Date('2026-07-31T12:00:00.000Z');

function makeIssue(over: Partial<ErrorIssue> = {}): ErrorIssue {
  return {
    id: 'iss_1',
    fingerprint: 'f1',
    source: ErrorSource.CHANNEL,
    code: 'WEBHOOK_INVALID_SIGNATURE',
    severity: ErrorSeverity.CRITICAL,
    status: ErrorIssueStatus.OPEN,
    title: 'Assinatura invalida',
    lastStack: null,
    count: 1,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastAlertedAt: null,
    resolvedAt: null,
    mutedUntil: null,
    organizationId: 'org_1',
    investigationPrUrl: null,
    investigationStatus: null,
    ...over,
  } as ErrorIssue;
}

function makeService(prismaOver: Record<string, unknown> = {}) {
  const prisma = {
    errorIssue: {
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue(undefined),
      ...(prismaOver.errorIssue as object),
    },
  };
  const config = {
    get: (key: string) =>
      ({
        TELEGRAM_ALERT_BOT_TOKEN: 'tok',
        TELEGRAM_ALERT_CHAT_ID: '123',
        ALERT_PANEL_BASE_URL: 'https://app.exemplo',
      })[key],
  } as unknown as ConfigService;
  return {
    service: new ErrorAlertService(prisma as never, config),
    prisma,
  };
}

describe('ErrorAlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    mockedAxios.post.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => jest.useRealTimers());

  it('alerta quando o issue nasce', async () => {
    const { service, prisma } = makeService();
    await service.maybeAlert(makeIssue(), 'new');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(prisma.errorIssue.update).toHaveBeenCalledWith({
      where: { id: 'iss_1' },
      data: { lastAlertedAt: NOW },
    });
  });

  it('inclui o link do painel na mensagem', async () => {
    const { service } = makeService();
    await service.maybeAlert(makeIssue(), 'new');
    const body = mockedAxios.post.mock.calls[0][1] as { text: string };
    expect(body.text).toContain('https://app.exemplo/bugs/iss_1');
  });

  it('nao alerta recorrencia dentro do cooldown', async () => {
    const { service } = makeService();
    const issue = makeIssue({
      lastAlertedAt: new Date(NOW.getTime() - 5 * 60_000),
    });
    await service.maybeAlert(issue, 'recurring');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('alerta recorrencia depois do cooldown', async () => {
    const { service } = makeService();
    const issue = makeIssue({
      lastAlertedAt: new Date(NOW.getTime() - 11 * 60_000),
    });
    await service.maybeAlert(issue, 'recurring');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('usa cooldown de 60min para severidade ERROR', async () => {
    const { service } = makeService();
    const issue = makeIssue({
      severity: ErrorSeverity.ERROR,
      lastAlertedAt: new Date(NOW.getTime() - 30 * 60_000),
    });
    await service.maybeAlert(issue, 'recurring');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('alerta regressao ignorando o cooldown', async () => {
    const { service } = makeService();
    const issue = makeIssue({ lastAlertedAt: NOW });
    await service.maybeAlert(issue, 'regression');
    const body = mockedAxios.post.mock.calls[0][1] as { text: string };
    expect(body.text).toContain('REGRESS');
  });

  it('nao alerta issue silenciado', async () => {
    const { service } = makeService();
    const issue = makeIssue({
      status: ErrorIssueStatus.MUTED,
      mutedUntil: new Date(NOW.getTime() + 3600_000),
    });
    await service.maybeAlert(issue, 'new');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('em tempestade manda um resumo so, nao um por issue', async () => {
    const { service, prisma } = makeService({
      errorIssue: { count: jest.fn().mockResolvedValue(7), update: jest.fn() },
    });
    await service.maybeAlert(makeIssue({ id: 'a' }), 'new');
    await service.maybeAlert(makeIssue({ id: 'b' }), 'new');
    await service.maybeAlert(makeIssue({ id: 'c' }), 'new');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const body = mockedAxios.post.mock.calls[0][1] as { text: string };
    expect(body.text).toContain('7');
    expect(prisma.errorIssue.count).toHaveBeenCalled();
  });

  it('falha do telegram nao propaga', async () => {
    const { service } = makeService();
    mockedAxios.post.mockRejectedValue(new Error('ECONNRESET'));
    await expect(service.maybeAlert(makeIssue(), 'new')).resolves.toBeUndefined();
  });

  it('fica desligado em silencio sem token configurado', async () => {
    const prisma = {
      errorIssue: { count: jest.fn(), update: jest.fn() },
    };
    const config = { get: () => undefined } as unknown as ConfigService;
    const service = new ErrorAlertService(prisma as never, config);
    await service.maybeAlert(makeIssue(), 'new');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
