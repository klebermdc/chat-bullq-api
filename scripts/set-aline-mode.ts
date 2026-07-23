/**
 * Mostra o mapa canal → agentes → modo, e (opcional) ajusta o modo da Aline
 * num canal específico. Útil pra montar um teste prático seguro: deixar a Aline
 * AUTONOMOUS só num canal de teste, com os reais em SHADOW.
 *
 * Login igual ao create-sdr-agent.ts (EMAIL+PASSWORD ou TOKEN+ORG_ID).
 *
 * Só LISTAR (não muda nada):
 *   API_URL=... EMAIL=... PASSWORD=... npx ts-node scripts/set-aline-mode.ts
 *
 * Colocar a Aline AUTONOMOUS num canal (por parte do nome, case-insensitive):
 *   API_URL=... EMAIL=... PASSWORD=... CHANNEL="teste" MODE=AUTONOMOUS \
 *     npx ts-node scripts/set-aline-mode.ts
 *
 * Voltar pra SHADOW:  CHANNEL="teste" MODE=SHADOW
 */

export {}; // isola o escopo do módulo (evita colisão com outros scripts no build)

const AGENT_NAME = process.env.AGENT_NAME || 'Aline';

async function resolveAuth(
  apiUrl: string,
): Promise<{ token: string; orgId: string }> {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  const orgIdEnv = (process.env.ORG_ID || '').trim();
  if (!email || !password) {
    const raw = (process.env.TOKEN || '').trim();
    if (raw && raw.length > 20 && orgIdEnv) return { token: raw, orgId: orgIdEnv };
    console.error(
      'Faça login: EMAIL=voce@dominio PASSWORD=suaSenha (ou TOKEN=<jwt> ORG_ID=<id>).',
    );
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
  const token =
    j.accessToken || j.access_token || j?.data?.accessToken || j?.data?.access_token;
  const orgs: any[] = j.organizations || j?.data?.organizations || [];
  const orgId = orgIdEnv || orgs[0]?.id;
  if (!token || !orgId) throw new Error('login sem token/org; passe ORG_ID=<id>.');
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
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return json?.data ?? json;
  };

  // Status de segurança: IA global da org. Se OFF, só conversas com "IA
  // forçada" disparam o agente — então ligar a Aline num canal real é seguro
  // (clientes novos sem IA forçada nem chegam a rodar).
  let org: any = null;
  try {
    org = await api('GET', '/organizations/current');
  } catch {
    /* segue sem status se o endpoint variar */
  }
  if (org) {
    const on = org.aiEnabled === true;
    console.log(
      `\n🌐 IA GLOBAL da org: ${on ? '🟢 LIGADA' : '⚪ DESLIGADA'} (aiEnabled=${org.aiEnabled}).` +
        (on
          ? '\n   ⚠️  Com a IA global LIGADA, um agente AUTONOMOUS pode pegar clientes' +
            '\n   novos no canal. Prefira o canal "teste" pro teste com o Rafael.'
          : '\n   ✅ Com a IA global DESLIGADA, só conversas com "IA forçada" rodam.' +
            '\n   Ligar a Aline (AUTONOMOUS) num canal real e testar a conversa' +
            '\n   pinada do Rafael é seguro — clientes novos não são tocados.'),
    );
  }

  const agents: any[] = await api('GET', '/ai-agents');

  // Monta mapa canal → [{agente, kind, modo}]
  const byChannel = new Map<string, { name: string; rows: any[] }>();
  for (const a of agents) {
    for (const link of a.channels ?? []) {
      const ch = link.channel || {};
      const key = ch.id || link.channelId;
      if (!byChannel.has(key)) byChannel.set(key, { name: ch.name || key, rows: [] });
      byChannel.get(key)!.rows.push({ agent: a.name, kind: a.kind, mode: link.mode });
    }
  }

  console.log('\n═══ Mapa canal → agentes → modo ═══');
  for (const [chId, { name, rows }] of byChannel) {
    console.log(`\n📡 ${name}  (${chId})`);
    for (const r of rows) {
      const flag = r.mode === 'AUTONOMOUS' ? '🟢' : r.mode === 'SHADOW' ? '🕶️ ' : '⚪';
      console.log(`   ${flag} ${r.agent} [${r.kind}] → ${r.mode}`);
    }
  }

  const wantChannel = (process.env.CHANNEL || '').trim().toLowerCase();
  const wantMode = (process.env.MODE || '').trim().toUpperCase();
  if (!wantChannel || !wantMode) {
    console.log(
      '\n(Só listagem. Pra mudar: CHANNEL="parte-do-nome" MODE=AUTONOMOUS|SHADOW)',
    );
    return;
  }

  const aline = agents.find((a) => a.name === AGENT_NAME);
  if (!aline) throw new Error(`Agente "${AGENT_NAME}" não encontrado.`);

  // Acha o canal pelo nome (parcial) a partir do mapa.
  const match = [...byChannel.entries()].filter(([, v]) =>
    v.name.toLowerCase().includes(wantChannel),
  );
  if (match.length === 0) throw new Error(`Nenhum canal com "${wantChannel}" no nome.`);
  if (match.length > 1) {
    console.log(
      `\n⚠️  "${wantChannel}" casou com ${match.length} canais: ${match
        .map(([, v]) => v.name)
        .join(', ')}. Seja mais específico.`,
    );
    return;
  }
  const [chId, chInfo] = match[0];

  // Avisa se algum OUTRO agente está AUTONOMOUS no mesmo canal (competiria).
  if (wantMode === 'AUTONOMOUS') {
    const competidores = chInfo.rows.filter(
      (r) => r.agent !== AGENT_NAME && r.mode === 'AUTONOMOUS',
    );
    if (competidores.length > 0) {
      console.log(
        `\n⚠️  ATENÇÃO: no canal "${chInfo.name}" já estão AUTONOMOUS: ` +
          `${competidores.map((c) => `${c.agent} [${c.kind}]`).join(', ')}.\n` +
          '   O roteador prefere o ORCHESTRATOR, então ELE pode responder no lugar\n' +
          '   da Aline. Pra um teste limpo, coloque esses em SHADOW/DISABLED neste\n' +
          '   canal (ou use um canal de teste sem orquestrador).',
      );
    }
  }

  // Trava de segurança no canal:
  // - AUTONOMOUS (ligar teste): canal em "Forçar OFF" (aiEnabled=false) → só
  //   conversas com "IA forçada" (a do Rafael) rodam; clientes novos ficam
  //   bloqueados no shouldHandle. Aline AUTONOMOUS deixa ela responder essas.
  // - SHADOW (desligar): restaura o canal pra padrão (aiEnabled=null).
  if (wantMode === 'AUTONOMOUS') {
    await api('PATCH', `/channels/${chId}`, { aiEnabled: false });
    console.log(`🔒 Canal "${chInfo.name}" → Forçar OFF (só IA forçada roda).`);
  } else if (wantMode === 'SHADOW') {
    await api('PATCH', `/channels/${chId}`, { aiEnabled: null });
    console.log(`🔓 Canal "${chInfo.name}" → padrão (aiEnabled=null) restaurado.`);
  }

  await api('POST', `/ai-agents/${aline.id}/channels`, {
    channelId: chId,
    mode: wantMode,
    trigger: 'ALWAYS',
  });
  console.log(`\n✅ Aline → ${wantMode} no canal "${chInfo.name}".`);
  if (wantMode === 'AUTONOMOUS') {
    console.log(
      '\n   PRÓXIMO PASSO no painel, na conversa do Rafael:\n' +
        '   1. Confirme que a Aline está pinada (dropdown "Aline" no topo).\n' +
        '   2. Confirme "IA forçada" ligado nessa conversa.\n' +
        '   3. Rafael manda a mensagem → só essa conversa responde.\n' +
        '\n   Ao terminar: rode com MODE=SHADOW pra silenciar e restaurar o canal.',
    );
  }
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
