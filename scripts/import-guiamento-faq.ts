/**
 * Importa o FAQ curado do Guiamento (prisma/seeds/guiamento-faq.json) para a
 * base de conhecimento de um agente, via o endpoint admin
 * POST /ai-agents/:agentId/knowledge/import. Idempotente (re-rodar não duplica).
 *
 * Uso:
 *   API_URL=https://api-ofpchat... AGENT_ID=<id> TOKEN=<jwt> \
 *     npx ts-node scripts/import-guiamento-faq.ts
 *
 * Ou por argumentos:
 *   npx ts-node scripts/import-guiamento-faq.ts <agentId> <token> [apiUrl]
 *
 * Requer Node 18+ (usa fetch global).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const agentId = process.env.AGENT_ID || process.argv[2];
  const token = process.env.TOKEN || process.argv[3];
  const apiUrl =
    process.env.API_URL || process.argv[4] || 'http://localhost:3001/api/v1';

  if (!agentId || !token) {
    console.error(
      'Faltam parâmetros. Use AGENT_ID e TOKEN (env) ou: ts-node scripts/import-guiamento-faq.ts <agentId> <token> [apiUrl]',
    );
    process.exit(1);
  }

  const file = join(__dirname, '..', 'prisma', 'seeds', 'guiamento-faq.json');
  const items = JSON.parse(readFileSync(file, 'utf8')) as {
    question: string;
    content: string;
    category: string;
  }[];

  const url = `${apiUrl.replace(/\/$/, '')}/ai-agents/${agentId}/knowledge/import`;
  console.log(`Importando ${items.length} itens para o agente ${agentId} em ${url} ...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`Falha (${res.status}): ${text}`);
    process.exit(1);
  }
  console.log('OK:', text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
