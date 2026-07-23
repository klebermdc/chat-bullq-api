export {}; // isola o escopo do módulo

/**
 * Adiciona a etapa "Pedido enviado" no FIM do funil de vendas (idempotente).
 * type=WON de propósito: assim o `moveCard` do E6 mantém o card como ganho ao
 * mover pra cá (etapa NORMAL resetaria pra OPEN). Preserva TODAS as etapas
 * existentes (o endpoint de stages é bulk-replace).
 *
 * Roda no MAC (não na VPS):
 *   API_URL=https://.../api/v1 EMAIL=admin@... PASSWORD=... \
 *     npx ts-node scripts/add-pedido-enviado-stage.ts
 *
 * Opcional: PIPELINE_NAME (default "vendas", match por contains) e
 * STAGE_NAME (default "Pedido enviado").
 */

const PIPELINE_MATCH = (process.env.PIPELINE_NAME || 'vendas').toLowerCase();
const STAGE_NAME = process.env.STAGE_NAME || 'Pedido enviado';
const STAGE_COLOR = process.env.STAGE_COLOR || 'violet';

async function resolveAuth(apiUrl: string): Promise<{ token: string; orgId: string }> {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  if (!email || !password) {
    console.error('Faça login: EMAIL=voce@dominio PASSWORD=suaSenha.');
    process.exit(1);
  }
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`login → ${res.status}: ${text.slice(0, 300)}`);
  const j: any = JSON.parse(text);
  const token = j.accessToken || j?.data?.accessToken;
  const orgId =
    (process.env.ORG_ID || '').trim() ||
    j.organizations?.[0]?.id ||
    j?.data?.organizations?.[0]?.id;
  if (!token || !orgId) throw new Error('login sem token/org.');
  console.log(`🔑 Login OK (${email}) — org ${orgId}.`);
  return { token, orgId };
}

async function main() {
  const apiUrl = (process.env.API_URL || '').replace(/\/$/, '');
  if (!apiUrl) {
    console.error('Falta API_URL.');
    process.exit(1);
  }
  const { token, orgId } = await resolveAuth(apiUrl);
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-organization-id': orgId,
    'Content-Type': 'application/json',
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await res.text();
    let j: any = null;
    try {
      j = t ? JSON.parse(t) : null;
    } catch {
      j = t;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 300)}`);
    return j?.data ?? j;
  };

  const pipelines: any[] = await api('GET', '/pipelines');
  const pipeline = pipelines.find((p) =>
    (p.name ?? '').toLowerCase().includes(PIPELINE_MATCH),
  );
  if (!pipeline) {
    throw new Error(
      `Nenhum pipeline com nome contendo "${PIPELINE_MATCH}". Pipelines: ${pipelines
        .map((p) => p.name)
        .join(', ')}`,
    );
  }
  console.log(`📋 Funil: "${pipeline.name}" (${pipeline.id}).`);

  const board = await api('GET', `/pipelines/${pipeline.id}/board`);
  const stages: any[] = board.stages ?? [];
  const already = stages.find((s) =>
    (s.name ?? '').toLowerCase().includes(STAGE_NAME.toLowerCase()),
  );
  if (already) {
    console.log(`✅ Etapa "${already.name}" já existe — nada a fazer.`);
    return;
  }

  const maxOrder = stages.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
  const payload = {
    stages: [
      // Preserva as existentes EXATAMENTE (id → upsert, não recria/apaga).
      ...stages.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color ?? undefined,
        type: s.type ?? 'NORMAL',
        order: s.order ?? 0,
      })),
      { name: STAGE_NAME, color: STAGE_COLOR, type: 'WON', order: maxOrder + 1 },
    ],
  };

  await api('PUT', `/pipelines/${pipeline.id}/stages`, payload);
  console.log(
    `✅ Etapa "${STAGE_NAME}" (type WON) adicionada no fim do funil "${pipeline.name}".`,
  );
  console.log(
    'Agora o botão 📦 "Pedido enviado" (E6) tem pra onde mover o card.',
  );
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
