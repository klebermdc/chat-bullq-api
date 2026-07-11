/**
 * Diagnóstico da Aline: re-confirma o modo dela por canal e lista os últimos
 * runs (AiAgentRun) — mostra se ela rodou e o desfecho, ou se nem foi acionada.
 *
 *   API_URL=... EMAIL=... PASSWORD=... npx ts-node scripts/aline-diag.ts
 */

export {}; // isola o escopo do módulo (evita colisão com outros scripts no build)

const AGENT_NAME = process.env.AGENT_NAME || 'Aline';

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
  const orgId = (process.env.ORG_ID || '').trim() || j.organizations?.[0]?.id || j?.data?.organizations?.[0]?.id;
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
  const api = async (method: string, path: string) => {
    const res = await fetch(`${apiUrl}${path}`, { method, headers });
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

  console.log('\n═══ Chaves de provedor de IA (o que está "plugado") ═══');
  try {
    const keys: any[] = await api('GET', '/ai-provider-keys');
    if (!keys.length) console.log('   (nenhuma — usa fallback de env SAKANA)');
    for (const k of keys) {
      console.log(
        `   • provider=${k.provider} | capabilities=${JSON.stringify(k.capabilities ?? k.capability ?? '?')}` +
          ` | model=${k.model ?? '(vazio)'} | baseUrl=${k.baseUrl ?? '(padrão)'}`,
      );
    }
  } catch (e: any) {
    console.log(`   (falha ao listar: ${e.message})`);
  }

  const agents: any[] = await api('GET', '/ai-agents');
  const aline = agents.find((a) => a.name === AGENT_NAME);
  if (!aline) throw new Error(`Agente "${AGENT_NAME}" não encontrado.`);

  console.log(`\n═══ Aline (id=${aline.id}) ═══`);
  console.log(`isActive: ${aline.isActive} | voiceProfile: ${aline.voiceProfile} | temperature: ${aline.temperature}`);
  const sp = String(aline.systemPrompt ?? '');
  console.log(`\n═══ systemPrompt LIVE (${sp.length} chars) — primeiras linhas ═══`);
  console.log(sp.split('\n').slice(0, 8).join('\n'));
  console.log('...');
  console.log(`Contém "Como posso te ajudar"? ${sp.includes('Como posso te ajudar') ? 'SIM ✅' : 'NÃO ❌'}`);
  console.log(`Contém "UMA pergunta por"? ${sp.includes('UMA pergunta') || sp.includes('uma pergunta') ? 'SIM ✅' : 'NÃO ❌'}`);
  console.log('Modo por canal:');
  for (const link of aline.channels ?? []) {
    const ch = link.channel || {};
    const flag = link.mode === 'AUTONOMOUS' ? '🟢' : '🕶️ ';
    console.log(`   ${flag} ${ch.name || link.channelId} → ${link.mode}`);
  }

  console.log('\n═══ Últimos runs da Aline ═══');
  let runs: any[] = [];
  try {
    runs = await api('GET', `/ai-agents/${aline.id}/runs?limit=15`);
  } catch (e: any) {
    console.log(`(falha ao buscar runs: ${e.message})`);
  }
  if (!Array.isArray(runs) || runs.length === 0) {
    console.log(
      '⚠️  NENHUM run registrado. A Aline NÃO foi acionada — o bloqueio é ANTES\n' +
        '   dela rodar (shouldHandle=false, SHADOW, ou a mensagem não disparou o\n' +
        '   pipeline). Não é erro dentro da Aline.',
    );
  } else {
    for (const r of runs.slice(0, 15)) {
      console.log(
        `• ${r.startedAt ?? r.createdAt} | status=${r.status} | finalAction=${r.finalAction ?? '-'}` +
          (r.errorMessage ? ` | ERRO: ${r.errorMessage}` : '') +
          ` | conv=${r.conversationId}`,
      );
    }
  }
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
