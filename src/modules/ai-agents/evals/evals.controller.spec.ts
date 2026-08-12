import { NotFoundException } from '@nestjs/common';

import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { EvalsController } from './evals.controller';
import type { EvalCase } from './types';

/**
 * O endpoint de evals executa o agent com `agent.organizationId` e devolve o
 * relatório do comportamento dele. Buscar o agent só por `id` deixava qualquer
 * usuário autenticado rodar — e ler — o agent de OUTRA empresa, queimando o
 * orçamento de token dela. Estes testes fixam o escopo por organização.
 */

type FakeAgent = {
  id: string;
  name: string;
  organizationId: string;
  deletedAt: Date | null;
};

/**
 * Fake com a semântica real do Prisma: `findFirst` casa TODOS os campos do
 * `where`, `findUnique` casa só o id. Assim o teste falha de verdade se a
 * implementação voltar a usar `findUnique({ where: { id } })` — em vez de
 * passar só porque o mock foi programado para devolver null.
 */
function fakePrisma(agents: FakeAgent[]) {
  return {
    aiAgent: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          agents.find((a) =>
            Object.entries(where).every(
              ([k, v]) => (a as unknown as Record<string, unknown>)[k] === v,
            ),
          ) ?? null,
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(agents.find((a) => a.id === where.id) ?? null),
      ),
    },
  };
}

const CASO: EvalCase = {
  name: 'caso ad-hoc',
  input: 'oi',
  expect: {} as EvalCase['expect'],
};

const AGENT_DA_ORG_B: FakeAgent = {
  id: 'agent-b',
  name: 'Aline',
  organizationId: 'org-b',
  deletedAt: null,
};

function montar(agents: FakeAgent[]) {
  const prisma = fakePrisma(agents);
  const runner = { runCase: jest.fn().mockResolvedValue({ passed: true }) };
  const reporter = {
    buildReport: jest.fn().mockReturnValue({ summary: 'ok' }),
    writeMarkdown: jest.fn().mockResolvedValue('/tmp/relatorio.md'),
  };
  const controller = new EvalsController(
    prisma as never,
    runner as never,
    reporter as never,
  );
  return { controller, prisma, runner, reporter };
}

describe('EvalsController', () => {
  it('exige vínculo com a organização, não só autenticação', () => {
    const guards = Reflect.getMetadata('__guards__', EvalsController);
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, OrgGuard, RolesGuard]),
    );
  });

  it('não alcança agent de outra organização', async () => {
    const { controller, runner } = montar([AGENT_DA_ORG_B]);

    await expect(
      controller.run('agent-b', 'org-a', { cases: [CASO] }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // O agent alheio nunca chega a rodar — senão o token dele já foi gasto.
    expect(runner.runCase).not.toHaveBeenCalled();
  });

  it('roda normalmente o agent da própria organização', async () => {
    const { controller, runner } = montar([AGENT_DA_ORG_B]);

    const resposta = await controller.run('agent-b', 'org-b', {
      cases: [CASO],
    });

    expect(runner.runCase).toHaveBeenCalledWith(CASO, 'Aline', 'org-b');
    expect(resposta.reportPath).toBe('/tmp/relatorio.md');
  });

  it('ignora agent soft-deletado', async () => {
    const { controller } = montar([
      { ...AGENT_DA_ORG_B, deletedAt: new Date('2026-01-01') },
    ]);

    await expect(
      controller.run('agent-b', 'org-b', { cases: [CASO] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
