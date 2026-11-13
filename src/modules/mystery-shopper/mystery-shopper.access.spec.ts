import { NotFoundException } from '@nestjs/common';
import { MysteryShopperAccess } from './mystery-shopper.access';

function setup(settings: unknown) {
  const findUnique = jest.fn().mockResolvedValue({ settings });
  return new MysteryShopperAccess({ organization: { findUnique } } as never);
}

describe('MysteryShopperAccess', () => {
  const settings = { mysteryShopper: { viewerEmails: ['admin@orlandofastpass.com.br'] } };

  test('viewer passa', async () => {
    await expect(setup(settings).assertViewer('org', 'admin@orlandofastpass.com.br')).resolves.toBeUndefined();
  });

  test('qualquer outro usuário, mesmo ADMIN/OWNER, recebe 404', async () => {
    await expect(setup(settings).assertViewer('org', 'dono@orlandofastpass.com.br')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('org sem configuração: ninguém vê', async () => {
    expect(await setup({}).isAllowed('org', 'admin@orlandofastpass.com.br')).toBe(false);
  });
});
