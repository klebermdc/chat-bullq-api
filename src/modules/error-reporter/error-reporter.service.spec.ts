import {
  ErrorIssueStatus,
  ErrorSeverity,
  ErrorSource,
} from '@prisma/client';
import { ErrorAlertService } from './error-alert.service';
import { ERROR_CODES } from './error-codes';
import { ErrorReporterService } from './error-reporter.service';
import { ErrorReportInput } from './error-reporter.types';

const INPUT: ErrorReportInput = {
  source: ErrorSource.CHANNEL,
  code: ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
  severity: ErrorSeverity.CRITICAL,
  message: 'Assinatura invalida',
  stack: 'Error: x\n    at C.f (/app/src/modules/channel-hub/a.ts:1:1)',
  organizationId: 'org_1',
  channelId: 'ch_1',
  conversationId: 'conv_1',
  contactId: 'ct_1',
  context: { channelType: 'WHATSAPP_OFFICIAL' },
};

function makeService(over: {
  findUnique?: jest.Mock;
  create?: jest.Mock;
  update?: jest.Mock;
  occCreate?: jest.Mock;
} = {}) {
  const issueCriado = {
    id: 'iss_1',
    status: ErrorIssueStatus.OPEN,
    severity: ErrorSeverity.CRITICAL,
    count: 1,
  };
  const prisma = {
    errorIssue: {
      findUnique: over.findUnique ?? jest.fn().mockResolvedValue(null),
      create: over.create ?? jest.fn().mockResolvedValue(issueCriado),
      update: over.update ?? jest.fn().mockResolvedValue(issueCriado),
    },
    errorOccurrence: {
      create: over.occCreate ?? jest.fn().mockResolvedValue({ id: 'occ_1' }),
    },
  };
  const alert = { maybeAlert: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new ErrorReporterService(
      prisma as never,
      alert as unknown as ErrorAlertService,
    ),
    prisma,
    alert,
  };
}

describe('ErrorReporterService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cria o issue e a ocorrencia quando o fingerprint e inedito', async () => {
    const { service, prisma, alert } = makeService();
    await service.ingest(INPUT);
    expect(prisma.errorIssue.create).toHaveBeenCalledTimes(1);
    expect(prisma.errorOccurrence.create).toHaveBeenCalledTimes(1);
    expect(alert.maybeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'iss_1' }),
      'new',
    );
  });

  it('grava o vinculo com a conversa e o contato na ocorrencia', async () => {
    const { service, prisma } = makeService();
    await service.ingest(INPUT);
    expect(prisma.errorOccurrence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv_1',
          contactId: 'ct_1',
          channelId: 'ch_1',
        }),
      }),
    );
  });

  it('incrementa o contador quando o issue ja existe', async () => {
    const { service, prisma, alert } = makeService({
      findUnique: jest.fn().mockResolvedValue({
        id: 'iss_1',
        status: ErrorIssueStatus.OPEN,
        severity: ErrorSeverity.CRITICAL,
        count: 4,
      }),
    });
    await service.ingest(INPUT);
    expect(prisma.errorIssue.create).not.toHaveBeenCalled();
    expect(prisma.errorIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ count: { increment: 1 } }),
      }),
    );
    expect(alert.maybeAlert).toHaveBeenCalledWith(expect.anything(), 'recurring');
  });

  it('reabre issue resolvido e alerta como regressao', async () => {
    const { service, prisma, alert } = makeService({
      findUnique: jest.fn().mockResolvedValue({
        id: 'iss_1',
        status: ErrorIssueStatus.RESOLVED,
        severity: ErrorSeverity.CRITICAL,
        count: 9,
      }),
    });
    await service.ingest(INPUT);
    expect(prisma.errorIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ErrorIssueStatus.OPEN,
          resolvedAt: null,
        }),
      }),
    );
    expect(alert.maybeAlert).toHaveBeenCalledWith(expect.anything(), 'regression');
  });

  it('nao lanca quando o banco esta fora', async () => {
    const { service } = makeService({
      findUnique: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    await expect(service.ingest(INPUT)).resolves.toBeUndefined();
  });

  it('nao lanca quando o alerta explode', async () => {
    const { service, alert } = makeService();
    alert.maybeAlert.mockRejectedValue(new Error('boom'));
    await expect(service.ingest(INPUT)).resolves.toBeUndefined();
  });

  it('report() devolve void e nao lanca nem com o banco fora', () => {
    const { service } = makeService({
      findUnique: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    expect(service.report(INPUT)).toBeUndefined();
  });

  it('trunca titulo gigante em 200 caracteres', async () => {
    const { service, prisma } = makeService();
    await service.ingest({ ...INPUT, message: 'x'.repeat(500) });
    const data = prisma.errorIssue.create.mock.calls[0][0].data;
    expect(data.title).toHaveLength(200);
  });

  it('cai para o caminho de update quando ha corrida no create (P2002)', async () => {
    const conflito = Object.assign(new Error('unique'), { code: 'P2002' });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'iss_1',
        status: ErrorIssueStatus.OPEN,
        severity: ErrorSeverity.CRITICAL,
        count: 1,
      });
    const { service, prisma } = makeService({
      findUnique,
      create: jest.fn().mockRejectedValue(conflito),
    });
    await service.ingest(INPUT);
    expect(prisma.errorIssue.update).toHaveBeenCalledTimes(1);
    expect(prisma.errorOccurrence.create).toHaveBeenCalledTimes(1);
  });

  it('escala a severidade quando o mesmo erro volta pior', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({
        id: 'iss_1',
        status: ErrorIssueStatus.OPEN,
        severity: ErrorSeverity.WARNING,
        count: 2,
      }),
    });
    await service.ingest({ ...INPUT, severity: ErrorSeverity.CRITICAL });
    expect(prisma.errorIssue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ severity: ErrorSeverity.CRITICAL }),
      }),
    );
  });

  it('NAO rebaixa a severidade quando o erro volta mais leve', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({
        id: 'iss_1',
        status: ErrorIssueStatus.OPEN,
        severity: ErrorSeverity.CRITICAL,
        count: 2,
      }),
    });
    await service.ingest({ ...INPUT, severity: ErrorSeverity.WARNING });
    const data = prisma.errorIssue.update.mock.calls[0][0].data;
    expect(data.severity).toBeUndefined();
  });

  it('descarta o report quando o issue some depois do conflito', async () => {
    const conflito = Object.assign(new Error('unique'), { code: 'P2002' });
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(conflito),
    });
    await expect(service.ingest(INPUT)).resolves.toBeUndefined();
    expect(prisma.errorOccurrence.create).not.toHaveBeenCalled();
  });

  it('descarta report acima do teto de ingestoes em voo', () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockImplementation(
        () => new Promise(() => undefined),
      ),
    });
    for (let i = 0; i < 25; i += 1) service.report(INPUT);
    expect(prisma.errorIssue.findUnique).toHaveBeenCalledTimes(20);
  });

  it('libera a vaga quando a ingestao termina', async () => {
    let liberar: () => void = () => undefined;
    const travado = new Promise((res) => {
      liberar = () => res(null);
    });
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockReturnValue(travado),
    });
    for (let i = 0; i < 21; i += 1) service.report(INPUT);
    expect(prisma.errorIssue.findUnique).toHaveBeenCalledTimes(20);
    liberar();
    await new Promise((r) => setTimeout(r, 20));
    service.report(INPUT);
    expect(prisma.errorIssue.findUnique).toHaveBeenCalledTimes(21);
  });

  it('oculta segredo do contexto antes de gravar a ocorrencia', async () => {
    const { service, prisma } = makeService();
    await service.ingest({
      ...INPUT,
      context: { channelType: 'X', locators: [{ token: 'segredo-vivo' }] },
    });
    const data = prisma.errorOccurrence.create.mock.calls[0][0].data;
    expect(JSON.stringify(data.context)).not.toContain('segredo-vivo');
    expect(JSON.stringify(data.context)).toContain('X');
  });
});
