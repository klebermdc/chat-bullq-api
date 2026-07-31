import { NotFoundException } from '@nestjs/common';
import {
  ErrorIssueStatus,
  ErrorSeverity,
  ErrorSource,
} from '@prisma/client';
import { ErrorPanelService } from './error-panel.service';

const NOW = new Date('2026-07-31T12:00:00.000Z');

function makeService(over: Record<string, jest.Mock> = {}) {
  const prisma = {
    errorIssue: {
      findMany: over.findMany ?? jest.fn().mockResolvedValue([]),
      count: over.count ?? jest.fn().mockResolvedValue(0),
      findUnique: over.findUnique ?? jest.fn().mockResolvedValue(null),
      update: over.update ?? jest.fn().mockResolvedValue({ id: 'iss_1' }),
    },
    errorOccurrence: {
      findMany: over.occFindMany ?? jest.fn().mockResolvedValue([]),
    },
    $queryRaw: over.queryRaw ?? jest.fn().mockResolvedValue([]),
  };
  return { service: new ErrorPanelService(prisma as never), prisma };
}

describe('ErrorPanelService.list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('ordena por ultima ocorrencia, mais recente primeiro', async () => {
    const { service, prisma } = makeService();
    await service.list({ page: 1, perPage: 25 });
    expect(prisma.errorIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { lastSeenAt: 'desc' } }),
    );
  });

  it('pagina com skip e take', async () => {
    const { service, prisma } = makeService();
    await service.list({ page: 3, perPage: 10 });
    expect(prisma.errorIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('filtra por fonte, severidade e status', async () => {
    const { service, prisma } = makeService();
    await service.list({
      page: 1,
      perPage: 25,
      source: ErrorSource.CHANNEL,
      severity: ErrorSeverity.CRITICAL,
      status: ErrorIssueStatus.OPEN,
    });
    expect(prisma.errorIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: ErrorSource.CHANNEL,
          severity: ErrorSeverity.CRITICAL,
          status: ErrorIssueStatus.OPEN,
        }),
      }),
    );
  });

  it('busca no titulo e no codigo, sem diferenciar maiuscula', async () => {
    const { service, prisma } = makeService();
    await service.list({ page: 1, perPage: 25, q: 'webhook' });
    const where = prisma.errorIssue.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { title: { contains: 'webhook', mode: 'insensitive' } },
      { code: { contains: 'webhook', mode: 'insensitive' } },
    ]);
  });

  it('nao filtra nada quando nenhum filtro vem', async () => {
    const { service, prisma } = makeService();
    await service.list({ page: 1, perPage: 25 });
    expect(prisma.errorIssue.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('devolve total e clientes afetados por issue numa consulta so', async () => {
    const { service, prisma } = makeService({
      findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      count: jest.fn().mockResolvedValue(2),
      queryRaw: jest
        .fn()
        .mockResolvedValue([{ issue_id: 'a', n: BigInt(3) }]),
    });
    const resultado = await service.list({ page: 1, perPage: 25 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(resultado.total).toBe(2);
    expect(resultado.items[0]).toEqual(
      expect.objectContaining({ id: 'a', impactedContacts: 3 }),
    );
    // Issue sem ocorrência com contato vira zero, não undefined.
    expect(resultado.items[1]).toEqual(
      expect.objectContaining({ id: 'b', impactedContacts: 0 }),
    );
  });

  it('nao consulta clientes afetados quando a pagina vem vazia', async () => {
    const { service, prisma } = makeService();
    await service.list({ page: 1, perPage: 25 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('ErrorPanelService.detail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('devolve o issue com as ultimas ocorrencias', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'iss_1' }),
      occFindMany: jest.fn().mockResolvedValue([{ id: 'occ_1' }]),
      queryRaw: jest
        .fn()
        .mockResolvedValue([{ issue_id: 'iss_1', n: BigInt(2) }]),
    });
    const resultado = await service.detail('iss_1');
    expect(resultado.occurrences).toHaveLength(1);
    expect(resultado.impactedContacts).toBe(2);
    expect(prisma.errorOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: 'iss_1' },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
    );
  });

  it('404 quando o issue nao existe', async () => {
    const { service } = makeService();
    await expect(service.detail('nao_existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ErrorPanelService.updateStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it('resolver grava a data e limpa o silenciamento', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'iss_1' }),
    });
    await service.updateStatus('iss_1', { status: ErrorIssueStatus.RESOLVED });
    expect(prisma.errorIssue.update).toHaveBeenCalledWith({
      where: { id: 'iss_1' },
      data: {
        status: ErrorIssueStatus.RESOLVED,
        resolvedAt: NOW,
        mutedUntil: null,
      },
    });
  });

  it('silenciar por prazo grava o prazo', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'iss_1' }),
    });
    const ate = '2026-08-01T12:00:00.000Z';
    await service.updateStatus('iss_1', {
      status: ErrorIssueStatus.MUTED,
      mutedUntil: ate,
    });
    expect(prisma.errorIssue.update).toHaveBeenCalledWith({
      where: { id: 'iss_1' },
      data: {
        status: ErrorIssueStatus.MUTED,
        resolvedAt: null,
        mutedUntil: new Date(ate),
      },
    });
  });

  it('silenciar sem prazo deixa mutedUntil nulo', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'iss_1' }),
    });
    await service.updateStatus('iss_1', { status: ErrorIssueStatus.MUTED });
    expect(prisma.errorIssue.update.mock.calls[0][0].data.mutedUntil).toBeNull();
  });

  it('reabrir limpa data de resolucao e de silenciamento', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'iss_1' }),
    });
    await service.updateStatus('iss_1', { status: ErrorIssueStatus.OPEN });
    expect(prisma.errorIssue.update).toHaveBeenCalledWith({
      where: { id: 'iss_1' },
      data: {
        status: ErrorIssueStatus.OPEN,
        resolvedAt: null,
        mutedUntil: null,
      },
    });
  });

  it('404 quando o issue nao existe', async () => {
    const { service } = makeService();
    await expect(
      service.updateStatus('nao_existe', { status: ErrorIssueStatus.OPEN }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
