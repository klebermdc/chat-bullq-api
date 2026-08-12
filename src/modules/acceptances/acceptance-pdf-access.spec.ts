import { NotFoundException } from '@nestjs/common';

import { AcceptancesService } from './acceptances.service';

/**
 * O PDF do aceite assinado saía por `/api/v1/uploads/acceptances/<data>/<id>.pdf`,
 * rota sem autenticação nenhuma — nome do cliente, assinatura e IP baixáveis
 * por qualquer pessoa com a URL, de qualquer organização.
 *
 * Agora ele sai por dois caminhos, cada um com seu fator de acesso:
 *   - o operador, por id, com JWT + organização conferida;
 *   - o cliente, pelo token do aceite (32 bytes aleatórios), que já é o único
 *     fator de acesso à página pública inteira.
 */

type Aceite = {
  id: string;
  organizationId: string;
  token: string;
  pdfKey: string | null;
};

const ACEITE_DA_ORG_B: Aceite = {
  id: 'acc-b',
  organizationId: 'org-b',
  token: 'tok-b',
  pdfKey: 'acceptances/2026-08-06/acc-b.pdf',
};

/** Fake com a semântica real do Prisma: o `where` casa por igualdade. */
function montar(aceites: Aceite[]) {
  const casa = (row: Aceite, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
    );
  const prisma = {
    orderAcceptance: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(aceites.find((r) => casa(r, where)) ?? null),
      ),
      findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(aceites.find((r) => casa(r, where)) ?? null),
      ),
    },
  };
  return new AcceptancesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('AcceptancesService — acesso ao PDF assinado', () => {
  it('não entrega o PDF de aceite de outra organização', async () => {
    const svc = montar([ACEITE_DA_ORG_B]);

    await expect(svc.pdfKeyForOrg('acc-b', 'org-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('entrega o PDF do aceite da própria organização', async () => {
    const svc = montar([ACEITE_DA_ORG_B]);

    expect(await svc.pdfKeyForOrg('acc-b', 'org-b')).toBe(
      'acceptances/2026-08-06/acc-b.pdf',
    );
  });

  it('entrega o PDF pelo token do aceite', async () => {
    const svc = montar([ACEITE_DA_ORG_B]);

    expect(await svc.pdfKeyByToken('tok-b')).toBe(
      'acceptances/2026-08-06/acc-b.pdf',
    );
  });

  it('token inexistente não encontra PDF', async () => {
    const svc = montar([ACEITE_DA_ORG_B]);

    await expect(svc.pdfKeyByToken('tok-inventado')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('aceite ainda não assinado não tem PDF para entregar', async () => {
    const svc = montar([{ ...ACEITE_DA_ORG_B, pdfKey: null }]);

    await expect(svc.pdfKeyByToken('tok-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.pdfKeyForOrg('acc-b', 'org-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
