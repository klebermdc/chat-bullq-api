// Uso: npx ts-node scripts/set-super-admin.ts <email>
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: npx ts-node scripts/set-super-admin.ts <email>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const user = await prisma.user.update({
    where: { email },
    data: { isSuperAdmin: true },
  });
  console.log(`✓ ${user.email} agora é super-admin da plataforma.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
