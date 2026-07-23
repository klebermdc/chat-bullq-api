import { PendingActionStorage } from './pending-action.storage';
import type { PendingAction } from './confirmation.types';

function makeAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 'pa1',
    agentRunId: 'run1',
    conversationId: 'conv1',
    agentId: 'agent1',
    toolName: 'transferToHuman',
    args: {},
    preview: { action: 'Transferir', impact: 'critical' },
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  } as PendingAction;
}

describe('PendingActionStorage.save', () => {
  it('persiste args/preview/expiresAt no UPDATE — não só o status (regressão do botão Distribuir)', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = { aiPendingAction: { upsert } } as any;
    const storage = new PendingActionStorage(prisma);

    // Simula o distribute(): mesmo status PENDING, mas args/preview/expiresAt novos.
    const distributedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const action = makeAction({
      args: { distributedTo: 'atendente9', distributedToName: 'Renata' },
      preview: { action: 'Distribuído para Renata', impact: 'critical' },
      expiresAt: distributedExpiry.toISOString(),
    });

    await storage.save(action, 'PENDING');

    const { create, update } = upsert.mock.calls[0][0];
    // O update precisa carregar o estado distribuído (era o bug: só ia no create).
    expect(update.args).toMatchObject({ distributedTo: 'atendente9' });
    expect(update.preview).toMatchObject({ action: 'Distribuído para Renata' });
    expect(update.expiresAt).toEqual(distributedExpiry);
    expect(update.status).toBe('PENDING');
    // create e update compartilham os mesmos campos mutáveis (nunca divergem).
    expect(update.args).toEqual(create.args);
    expect(update.preview).toEqual(create.preview);
    expect(update.expiresAt).toEqual(create.expiresAt);
  });
});
