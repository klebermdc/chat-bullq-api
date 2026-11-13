import { PRISMA_CLIENT_OPTIONS } from './prisma.service';

describe('PrismaService', () => {
  test('nunca devolve a marca de cliente oculto do contato', () => {
    expect(PRISMA_CLIENT_OPTIONS.omit.contact.isMysteryShopper).toBe(true);
  });
});
