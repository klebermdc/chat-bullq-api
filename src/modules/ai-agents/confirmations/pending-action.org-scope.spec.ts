import { NotFoundException } from '@nestjs/common';

import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { PendingActionController } from './pending-action.controller';
import { PendingActionService } from './pending-action.service';
import { PendingActionStorage } from './pending-action.storage';
import type { PendingAction } from './confirmation.types';

/**
 * `GET /pending-actions` não tinha OrgGuard e o storage não filtrava por
 * organização — a tabela `ai_pending_actions` nem tinha a coluna. Qualquer
 * usuário autenticado listava as pendências de TODAS as empresas (o resumo da
 * conversa do `transferToHuman` vai no `args`) e podia aprovar, rejeitar ou
 * distribuir a conversa de outra empresa passando o id.
 *
 * Estes testes fixam o escopo por organização na camada de storage, que é por
 * onde approve/reject/distribute passam.
 */

type Linha = {
  id: string;
  organizationId: string | null;
  agentRunId: string;
  conversationId: string;
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  preview: Record<string, unknown>;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  executionResult: unknown;
};

function linha(over: Partial<Linha> = {}): Linha {
  return {
    id: 'pa-b',
    organizationId: 'org-b',
    agentRunId: 'run1',
    conversationId: 'conv-b',
    agentId: 'agent1',
    toolName: 'transferToHuman',
    args: { summary: 'cliente quer 4 ingressos do Magic Kingdom' },
    preview: { action: 'Transferir', impact: 'critical' },
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectedReason: null,
    executionResult: null,
    ...over,
  };
}

/**
 * Fake com a semântica real do Prisma: o `where` casa por igualdade em TODOS
 * os campos informados. Se a implementação parar de mandar `organizationId`,
 * a linha da outra org volta a casar e o teste falha — que é o ponto.
 */
function fakePrisma(linhas: Linha[]) {
  const casa = (row: Linha, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
    );
  return {
    aiPendingAction: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(linhas.find((r) => casa(r, where)) ?? null),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(linhas.find((r) => r.id === where.id) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(linhas.filter((r) => casa(r, where))),
      ),
      upsert: jest.fn(
        (_args: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => Promise.resolve(undefined),
      ),
    },
  };
}

const ACAO_DA_ORG_B: PendingAction = {
  id: 'pa-b',
  organizationId: 'org-b',
  agentRunId: 'run1',
  conversationId: 'conv-b',
  agentId: 'agent1',
  toolName: 'transferToHuman',
  args: {},
  preview: { action: 'Transferir', impact: 'critical' },
  status: 'PENDING',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
} as PendingAction;

describe('PendingActionController — guards', () => {
  it('exige vínculo com a organização, não só autenticação', () => {
    const guards = Reflect.getMetadata('__guards__', PendingActionController);
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, OrgGuard, RolesGuard]),
    );
  });
});

describe('PendingActionStorage — escopo por organização', () => {
  it('não devolve ação de outra organização no get', async () => {
    const prisma = fakePrisma([linha()]);
    const storage = new PendingActionStorage(prisma as never);

    expect(await storage.get('pa-b', 'org-a')).toBeNull();
  });

  it('devolve a ação da própria organização', async () => {
    const prisma = fakePrisma([linha()]);
    const storage = new PendingActionStorage(prisma as never);

    const achada = await storage.get('pa-b', 'org-b');
    expect(achada?.id).toBe('pa-b');
  });

  it('listByStatus só traz as pendências da organização pedida', async () => {
    const prisma = fakePrisma([
      linha({ id: 'pa-a', organizationId: 'org-a', conversationId: 'conv-a' }),
      linha(),
    ]);
    const storage = new PendingActionStorage(prisma as never);

    const daOrgA = await storage.listByStatus('PENDING', 'org-a');

    expect(daOrgA.map((a) => a.id)).toEqual(['pa-a']);
  });

  it('não enxerga ação órfã, sem organização', async () => {
    const prisma = fakePrisma([linha({ organizationId: null })]);
    const storage = new PendingActionStorage(prisma as never);

    // Órfã (conversa apagada) nunca casa com nenhuma org — fail-closed, em vez
    // de aparecer para todo mundo.
    expect(await storage.listByStatus('PENDING', 'org-b')).toEqual([]);
    expect(await storage.get('pa-b', 'org-b')).toBeNull();
  });

  it('grava a organização ao salvar', async () => {
    const prisma = fakePrisma([]);
    const storage = new PendingActionStorage(prisma as never);

    await storage.save(ACAO_DA_ORG_B);

    const { create } = prisma.aiPendingAction.upsert.mock.calls[0][0];
    expect(create.organizationId).toBe('org-b');
  });
});

describe('PendingActionService — ações de outra organização', () => {
  function montar() {
    const prisma = fakePrisma([linha()]);
    const storage = new PendingActionStorage(prisma as never);
    const fila = { add: jest.fn().mockResolvedValue(undefined) };
    const saudacao = { enviarSeConfigurada: jest.fn() };
    const service = new PendingActionService(
      storage,
      fila as never,
      prisma as never,
      saudacao as never,
    );
    return { service, fila };
  }

  it('approve não alcança ação de outra organização', async () => {
    const { service, fila } = montar();

    await expect(service.approve('pa-b', 'org-a', 'user-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Nada foi enfileirado: a tool da outra empresa não chegou a executar.
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('reject não alcança ação de outra organização', async () => {
    const { service } = montar();

    await expect(
      service.reject('pa-b', 'org-a', 'user-a', 'não quero'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('distribute não alcança ação de outra organização', async () => {
    const { service } = montar();

    await expect(
      service.distribute('pa-b', 'org-a', 'user-a', 'atendente-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listPending só devolve as pendências da própria organização', async () => {
    const { service } = montar();

    expect(await service.listPending('org-a')).toEqual([]);
    expect((await service.listPending('org-b')).map((a) => a.id)).toEqual([
      'pa-b',
    ]);
  });
});
