// Ensaio local (não roda em produção): o UmblerHistoryService contra um banco
// carregado pelo carregar.sql. Uso: DATABASE_URL=... npx ts-node scripts/historico-umbler/ensaio-servico.ts <telefone>
import { PrismaClient } from '@prisma/client';
import { UmblerHistoryService } from '../../src/modules/messaging/messages/umbler-history.service';

async function main() {
  const phone = process.argv[2];
  const prisma = new PrismaClient();
  const entry = { resolveEntryContact: async () => ({ id: 'c1', phone }) };
  const service = new UmblerHistoryService(prisma as any, entry as any);

  const availability = await service.availability('conv', 'org1', 'ALL');
  console.log('availability', availability);

  const first = await service.findOlder('conv', 'org1', { limit: 3 }, 'ALL');
  console.log('página 1', first.hasMore, first.messages.map((m) => [m.sentAt.toISOString(), m.origin, m.text.slice(0, 40)]));
  const oldest = first.messages[0];
  const second = await service.findOlder('conv', 'org1', { limit: 3, beforeAt: oldest.sentAt, beforeId: oldest.id }, 'ALL');
  console.log('página 2', second.hasMore, second.messages.map((m) => [m.sentAt.toISOString(), m.origin, m.text.slice(0, 40)]));
  console.log('conversas', Object.values({ ...first.conversations, ...second.conversations }));
  const overlap = second.messages.filter((m) => first.messages.some((f) => f.id === m.id));
  console.log('repetidas entre páginas:', overlap.length, '| p2 toda antes da p1:', second.messages.every((m) => m.sentAt <= oldest.sentAt));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
