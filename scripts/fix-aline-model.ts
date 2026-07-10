/**
 * Corrige o modelo da Aline: o provedor Sakana não aceita 'fugu' (usado por
 * padrão nas iterações de ferramenta). Força o modelo válido
 * 'sakana/fugu-ultra-20260615' em TODAS as fases (alwaysPrimary).
 *
 *   API_URL=... EMAIL=... PASSWORD=... npx ts-node scripts/fix-aline-model.ts
 */

export {}; // isola o escopo do módulo (evita colisão com outros scripts no build)

const AGENT_NAME = process.env.AGENT_NAME || 'Aline';
const GOOD_MODEL = 'sakana/fugu-ultra-20260615';

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
    const text = await res.text();
    let j: any = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      j = text;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return j?.data ?? j;
  };

  const agents: any[] = await api('GET', '/ai-agents');
  const aline = agents.find((a) => a.name === AGENT_NAME);
  if (!aline) throw new Error(`Agente "${AGENT_NAME}" não encontrado.`);

  console.log(`Antes → modelId=${aline.modelId}, modelParams=${JSON.stringify(aline.modelParams)}`);

  const updated = await api('PATCH', `/ai-agents/${aline.id}`, {
    modelId: GOOD_MODEL,
    modelParams: { routing: { primary: GOOD_MODEL, alwaysPrimary: true } },
  });

  console.log(
    `✅ Aline atualizada → modelId=${updated.modelId}, ` +
      `modelParams=${JSON.stringify(updated.modelParams)}`,
  );
  console.log(
    '\nAgora peça pro contato mandar uma NOVA mensagem na conversa (com IA\n' +
      'forçada ligada) — a Aline deve responder na voz warm. Se ainda falhar,\n' +
      'rode scripts/aline-diag.ts e me mande o erro do run.',
  );
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
