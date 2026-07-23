/**
 * Semeia as Tools + Skills do "Co-piloto Interno" (Orlando Fast Pass) via API.
 *
 * Cria (idempotente, por nome):
 *   Tools:  "HUB ai-report" (CUSTOM_HTTP) e "OFP Chat DB (read-only)" (CUSTOM_SQL)
 *   Skills: vendasDoVendedorNoMes, vendasDaEquipeNoMes, listarVendedores,
 *           buscarClientePorTelefone, ultimaPropostaDoCliente,
 *           leadsEmAbertoDoAtendente, funilPorEtapa
 * Reexecutar ATUALIZA (PATCH) as existentes — seguro rodar de novo.
 *
 * PRÉ-REQUISITO de infra: NENHUM. As tools reaproveitam env vars que a API já
 * tem — OFP_BASE_URL + OFP_API_KEY (Relatórios de Vendas) pro HUB, e DATABASE_URL
 * (com trava read-only do executor) pro SQL. Nada novo pra setar no VPS.
 * Endurecimento opcional depois: trocar o DATABASE_URL por um DSN readonly_ai
 * (ver docs/skills-copiloto-interno.md).
 *
 * Uso (RODAR DO MAC, não no VPS — ts-node quebra lá):
 *   EMAIL=admin@orlandofastpass.com.br PASSWORD=<senha> \
 *   API_URL=https://api-ofpchat.explotek.pro/api/v1 \
 *     npx ts-node scripts/seed-copiloto-skills.ts
 *
 * Opcional — também criar/atribuir o agente "Copiloto" (passo 2 automatizado):
 *   COPILOT_AGENT="Copiloto"      atribui as 7 skills a esse agente (PUT/replace).
 *   CREATE_AGENT=1                 cria o agente se não existir (kind WORKER) e
 *                                  FORÇA SHADOW em todos os canais (não responde cliente).
 *   INTERNAL_CHANNEL_ID=<id>       liga AUTONOMOUS só nesse canal interno (o time fala por ele).
 *   Ex.: COPILOT_AGENT="Copiloto" CREATE_AGENT=1 INTERNAL_CHANNEL_ID=<id> EMAIL=... PASSWORD=... API_URL=... npx ts-node scripts/seed-copiloto-skills.ts
 *
 * Requer Node 18+ (fetch global).
 */

export {}; // isola o escopo do módulo

// ─────────────────────────────────────────────────────────────────────────────
// Definições das Tools (providers)
// ─────────────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'HUB ai-report',
    description: 'API de relatório do OFP HUB (pedidos/vendedores).',
    source: 'CUSTOM_HTTP',
    // Reaproveita as env vars que a API JÁ tem (usadas pelos Relatórios de Vendas).
    httpBaseUrl: '{{env.OFP_BASE_URL}}', // = https://<proj>.supabase.co/functions/v1/ai-report
    httpHeaders: {
      Authorization: 'Bearer {{env.OFP_API_KEY}}',
      Accept: 'application/json',
    },
  },
  {
    name: 'OFP Chat DB (read-only)',
    description: 'Consulta read-only no banco do próprio OFP Chat.',
    source: 'CUSTOM_SQL',
    // Zero-infra: usa o DATABASE_URL que a API já tem. A leitura é forçada
    // read-only pelo executor (SET TRANSACTION READ ONLY + bloqueio de escrita).
    // Endurecimento opcional depois: trocar por um DSN de usuário readonly_ai.
    sqlConnectionRef: 'DATABASE_URL',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Definições das Skills. `tool` referencia TOOLS[].name; resolvido pra toolId.
// SQL usa \\D no fonte pra o valor final chegar como \D (regex de não-dígito).
// ─────────────────────────────────────────────────────────────────────────────
const SKILLS: any[] = [
  // ── VENDAS (HTTP → HUB ai-report) ──────────────────────────────────────────
  {
    name: 'vendasDoVendedorNoMes',
    tool: 'HUB ai-report',
    description:
      'Retorna os pedidos de um vendedor num mês/ano do OFP HUB (nº de pedidos, valores, status).',
    promptInstructions:
      'Use quando perguntarem sobre as vendas/pedidos de UM vendedor específico num mês. Peça o nome do vendedor, o mês (1-12) e o ano se não estiverem claros.',
    source: 'HTTP',
    httpMethod: 'GET',
    httpPath:
      '?table=orders&vendedor={{input.vendedor}}&month={{input.mes}}&year={{input.ano}}',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['vendedor', 'mes', 'ano'],
      properties: {
        vendedor: { type: 'string', description: 'Nome do vendedor (ex.: Pedro, Marcella)' },
        mes: { type: 'integer', minimum: 1, maximum: 12 },
        ano: { type: 'integer', minimum: 2024 },
      },
    },
  },
  {
    name: 'vendasDaEquipeNoMes',
    tool: 'HUB ai-report',
    description:
      'Retorna TODOS os pedidos de um mês/ano do OFP HUB, pra somar total e comparar vendedores.',
    promptInstructions:
      'Use pra visão do time no mês (total vendido, ranking). Depois de receber as linhas, some por vendedor e apresente o ranking.',
    source: 'HTTP',
    httpMethod: 'GET',
    httpPath: '?table=orders&month={{input.mes}}&year={{input.ano}}&per_page=2000',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['mes', 'ano'],
      properties: {
        mes: { type: 'integer', minimum: 1, maximum: 12 },
        ano: { type: 'integer', minimum: 2024 },
      },
    },
  },
  {
    name: 'listarVendedores',
    tool: 'HUB ai-report',
    description: 'Lista os vendedores/perfis cadastrados no OFP HUB (nome e papel).',
    promptInstructions:
      'Use quando perguntarem quem são os vendedores ou pra confirmar o nome exato antes de consultar vendas.',
    source: 'HTTP',
    httpMethod: 'GET',
    httpPath: '?table=user_roles',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },

  // ── CLIENTE / FUNIL (SQL → OFP Chat DB, read-only, escopo ctx.organizationId) ─
  {
    name: 'buscarClientePorTelefone',
    tool: 'OFP Chat DB (read-only)',
    description:
      'Busca um contato pelo telefone (ignora máscara) e traz status da conversa, termômetro e atendente responsável.',
    promptInstructions:
      'Use quando pedirem informações de um cliente por telefone. Só os dígitos importam; pode passar com ou sem DDD.',
    source: 'SQL',
    sqlReadOnly: true,
    sqlMaxRows: 5,
    sqlQuery: `SELECT c.name AS cliente, c.phone, c.email,
       conv.status, conv.temperature,
       conv.awaiting_human_reply AS esperando,
       u.name AS atendente,
       conv.last_inbound_at
FROM contacts c
LEFT JOIN LATERAL (
  SELECT cv.* FROM conversations cv
  WHERE cv.contact_id = c.id AND cv.deleted_at IS NULL
  ORDER BY cv.last_message_at DESC NULLS LAST
  LIMIT 1
) conv ON true
LEFT JOIN users u ON u.id = conv.assigned_to_id
WHERE c.organization_id = $1
  AND c.deleted_at IS NULL
  AND regexp_replace(coalesce(c.phone,''), '\\D', '', 'g')
      LIKE '%' || regexp_replace($2, '\\D', '', 'g') || '%'
LIMIT 5;`,
    sqlParamMap: [{ source: 'ctx.organizationId' }, { source: 'input.telefone' }],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['telefone'],
      properties: {
        telefone: { type: 'string', description: 'Telefone do cliente (com ou sem máscara/DDD)' },
      },
    },
  },
  {
    name: 'ultimaPropostaDoCliente',
    tool: 'OFP Chat DB (read-only)',
    description:
      'Traz a proposta de carrinho mais recente de um cliente (adultos, crianças, datas, parques, valor, link).',
    promptInstructions:
      'Use quando quiserem revisar o que já foi proposto a um cliente antes de retomar o atendimento.',
    source: 'SQL',
    sqlReadOnly: true,
    sqlMaxRows: 1,
    sqlQuery: `SELECT c.name AS cliente, p.adults AS adultos, p.children AS criancas,
       p.start_date AS inicio, p.end_date AS fim, p.parks AS parques,
       p.total_value AS valor, p.currency, p.checkout_url, p.created_at
FROM proposals p
JOIN contacts c ON c.id = p.contact_id
WHERE p.organization_id = $1
  AND regexp_replace(coalesce(c.phone,''), '\\D', '', 'g')
      LIKE '%' || regexp_replace($2, '\\D', '', 'g') || '%'
ORDER BY p.created_at DESC
LIMIT 1;`,
    sqlParamMap: [{ source: 'ctx.organizationId' }, { source: 'input.telefone' }],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['telefone'],
      properties: { telefone: { type: 'string', description: 'Telefone do cliente' } },
    },
  },
  {
    name: 'leadsEmAbertoDoAtendente',
    tool: 'OFP Chat DB (read-only)',
    description:
      'Conta conversas em aberto e "esperando resposta" atribuídas a um atendente (busca pelo nome).',
    promptInstructions:
      'Use pra medir a fila de um atendente. Aceita parte do nome (ex.: "marc" acha Marcella).',
    source: 'SQL',
    sqlReadOnly: true,
    sqlMaxRows: 10,
    sqlQuery: `SELECT u.name AS atendente,
       count(*) FILTER (WHERE cv.status <> 'CLOSED') AS em_aberto,
       count(*) FILTER (WHERE cv.awaiting_human_reply) AS esperando_resposta
FROM users u
JOIN conversations cv ON cv.assigned_to_id = u.id
WHERE cv.organization_id = $1
  AND cv.deleted_at IS NULL
  AND cv.is_archived = false
  AND lower(u.name) LIKE '%' || lower($2) || '%'
GROUP BY u.name
ORDER BY em_aberto DESC;`,
    sqlParamMap: [{ source: 'ctx.organizationId' }, { source: 'input.atendente' }],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['atendente'],
      properties: { atendente: { type: 'string', description: 'Nome (ou parte) do atendente' } },
    },
  },
  {
    name: 'funilPorEtapa',
    tool: 'OFP Chat DB (read-only)',
    description:
      'Conta cards abertos e soma valores por etapa de um pipeline (busca pelo nome do pipeline).',
    promptInstructions:
      'Use pra dar visão do funil por etapa. Passe o nome do pipeline (ex.: "Vendas OFP").',
    source: 'SQL',
    sqlReadOnly: true,
    sqlMaxRows: 50,
    sqlQuery: `SELECT s.name AS etapa,
       count(cd.id) AS cards,
       coalesce(sum(cd.value), 0) AS valor_total
FROM pipeline_stages s
JOIN pipelines pl ON pl.id = s.pipeline_id AND pl.organization_id = $1
LEFT JOIN cards cd ON cd.stage_id = s.id AND cd.status = 'OPEN'
WHERE pl.archived = false
  AND lower(pl.name) LIKE '%' || lower($2) || '%'
GROUP BY s.name, s."order"
ORDER BY s."order";`,
    sqlParamMap: [{ source: 'ctx.organizationId' }, { source: 'input.pipeline' }],
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['pipeline'],
      properties: { pipeline: { type: 'string', description: 'Nome do pipeline (ex.: Vendas OFP)' } },
    },
  },
];

// systemPrompt do agente interno (co-piloto do time — NÃO fala com cliente).
const CO_PILOT_PROMPT = `Você é o "Copiloto", assistente INTERNO da equipe da Orlando Fast Pass.
Quem fala com você é um ATENDENTE ou o GESTOR — nunca um cliente. Sua função é
responder perguntas sobre vendas, clientes e o funil usando SUAS SKILLS.

Regras:
- Responda em português do Brasil, curto e direto (é chat de trabalho).
- SEMPRE use as skills disponíveis pra buscar o dado real. NUNCA invente número,
  valor, status ou nome — se a skill não retornar, diga que não encontrou.
- Ao trazer vendas, some e organize (ex.: ranking, total). Ao trazer cliente,
  destaque status, termômetro e atendente responsável.
- Se faltar um parâmetro (mês, nome, telefone, pipeline), pergunte objetivamente.
- Você NÃO atende cliente, NÃO envia proposta e NÃO fala em nome da empresa pra
  fora. É ferramenta interna de consulta.`;

// ─────────────────────────────────────────────────────────────────────────────
// Auth: login (EMAIL+PASSWORD) → token + orgId; ou TOKEN + ORG_ID.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveAuth(apiUrl: string): Promise<{ token: string; orgId: string }> {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  const orgIdEnv = (process.env.ORG_ID || '').trim();

  if (!email || !password) {
    const raw = (process.env.TOKEN || '').trim();
    if (raw && raw.length > 20) {
      if (!orgIdEnv) {
        console.error('Com TOKEN você também precisa de ORG_ID=<id da organização>.');
        process.exit(1);
      }
      return { token: raw, orgId: orgIdEnv };
    }
    console.error(
      'Sem credencial. Rode:\n' +
        '  EMAIL=voce@dominio PASSWORD=suaSenha API_URL=<.../api/v1> npx ts-node scripts/seed-copiloto-skills.ts\n' +
        '(ou TOKEN=<jwt> ORG_ID=<id>)',
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
  if (!token) throw new Error(`login OK mas sem accessToken: ${text.slice(0, 200)}`);

  const orgs: any[] = j.organizations || j?.data?.organizations || [];
  let orgId = orgIdEnv;
  if (!orgId) {
    if (orgs.length === 0) throw new Error('login OK mas sem organização; rode com ORG_ID=<id>.');
    orgId = orgs[0].id;
    if (orgs.length > 1) {
      console.log(`ℹ️  ${orgs.length} orgs; usando a 1ª: ${orgs[0].name || orgId} (${orgId}).`);
    }
  }
  console.log(`🔑 Login OK (${email}) — org ${orgId}.`);
  return { token, orgId };
}

async function main() {
  const apiUrl = (process.env.API_URL || process.argv[2] || '').replace(/\/$/, '');
  if (!apiUrl) {
    console.error('Falta API_URL. Ex: API_URL=https://api-ofpchat.explotek.pro/api/v1');
    process.exit(1);
  }
  const { token, orgId } = await resolveAuth(apiUrl);

  const headers = {
    Authorization: `Bearer ${token}`,
    'x-organization-id': orgId,
    'Content-Type': 'application/json',
  };
  const unwrap = (r: any) => (Array.isArray(r) ? r : r?.data ?? []);
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
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return json?.data ?? json;
  };

  // 1) TOOLS (idempotente por nome; PATCH se já existir)
  const existingTools = unwrap(await api('GET', '/ai-catalog/tools'));
  const toolIdByName = new Map<string, string>();
  for (const def of TOOLS) {
    const found = existingTools.find((t: any) => t.name === def.name);
    if (found) {
      await api('PATCH', `/ai-catalog/tools/${found.id}`, def);
      toolIdByName.set(def.name, found.id);
      console.log(`↩︎  Tool "${def.name}" já existia → atualizada (id=${found.id}).`);
    } else {
      const created = await api('POST', '/ai-catalog/tools', def);
      toolIdByName.set(def.name, created.id);
      console.log(`✅ Tool "${def.name}" criada (id=${created.id}).`);
    }
  }

  // 2) SKILLS (idempotente por nome; PATCH se já existir)
  const existingSkills = unwrap(await api('GET', '/ai-catalog/skills'));
  const createdSkillIds: string[] = [];
  for (const s of SKILLS) {
    const toolId = toolIdByName.get(s.tool);
    if (!toolId) throw new Error(`Skill "${s.name}" referencia tool inexistente "${s.tool}".`);
    const { tool, ...rest } = s;
    const dto = { ...rest, toolId };
    const found = existingSkills.find((x: any) => x.name === s.name);
    if (found) {
      await api('PATCH', `/ai-catalog/skills/${found.id}`, dto);
      createdSkillIds.push(found.id);
      console.log(`↩︎  Skill "${s.name}" já existia → atualizada (id=${found.id}).`);
    } else {
      const created = await api('POST', '/ai-catalog/skills', dto);
      createdSkillIds.push(created.id);
      console.log(`✅ Skill "${s.name}" criada (id=${created.id}).`);
    }
  }

  // 3) (Opcional) Agente Copiloto — criação 100% segura (nunca responde cliente):
  //    cria DESLIGADO (isActive:false) → desvincula de TODOS os canais de cliente
  //    → deixa só o canal interno AUTONOMOUS → anexa skills → só então LIGA.
  const agentName = (process.env.COPILOT_AGENT || '').trim();
  if (agentName) {
    const agents = unwrap(await api('GET', '/ai-agents'));
    let agent = agents.find((a: any) => a.name === agentName);
    let justCreated = false;

    if (!agent && process.env.CREATE_AGENT) {
      const internalCh = (process.env.INTERNAL_CHANNEL_ID || '').trim();
      if (!internalCh) {
        throw new Error(
          'CREATE_AGENT exige INTERNAL_CHANNEL_ID=<id do canal interno> — sem isso o ' +
            'agente ficaria AUTONOMOUS em todos os canais (responderia cliente).',
        );
      }
      const modelId =
        process.env.MODEL_ID || agents.find((a: any) => a.modelId)?.modelId || 'sakana/fugu-ultra';
      // Cria DESLIGADO: mesmo com o auto-link AUTONOMOUS do create(), inativo = não responde ninguém.
      agent = await api('POST', '/ai-agents', {
        name: agentName,
        kind: 'WORKER',
        category: 'copiloto-interno',
        department: 'OPERACOES',
        modelId,
        temperature: 0.4,
        maxTokens: 2048,
        systemPrompt: CO_PILOT_PROMPT,
        description: 'Co-piloto interno do time (consulta vendas/clientes/funil). Não fala com cliente.',
        isActive: false,
      });
      justCreated = true;
      console.log(`✅ Agente "${agentName}" criado DESLIGADO (id=${agent.id}, modelId=${modelId}).`);

      // create() auto-linkou AUTONOMOUS em todos os canais. DESVINCULA de todos menos o interno.
      const channels = unwrap(await api('GET', '/channels'));
      for (const ch of channels) {
        if (ch.id === internalCh) continue;
        await api('DELETE', `/ai-agents/${agent.id}/channels/${ch.id}`).catch(() => undefined);
      }
      // Garante o canal interno em AUTONOMOUS (o time conversa por ele).
      await api('POST', `/ai-agents/${agent.id}/channels`, {
        channelId: internalCh,
        mode: 'AUTONOMOUS',
        trigger: 'ALWAYS',
      });
      console.log(
        `🔌 Desvinculado de ${channels.length - 1} canais de cliente; ativo só no interno ${internalCh}.`,
      );
    }

    if (!agent) {
      console.warn(
        `⚠️  COPILOT_AGENT="${agentName}" não encontrado (e CREATE_AGENT não setado). ` +
          `Rode com CREATE_AGENT=1 INTERNAL_CHANNEL_ID=<id> pra criar, ou crie na UI e rode de novo.`,
      );
    } else {
      await api('PUT', `/ai-catalog/agents/${agent.id}/skills`, { skillIds: createdSkillIds });
      console.log(`🔗 ${createdSkillIds.length} skills atribuídas ao agente "${agentName}" (id=${agent.id}).`);

      // Só agora que canais + skills estão prontos: LIGA o agente (fecha a janela de risco).
      if (justCreated) {
        await api('PATCH', `/ai-agents/${agent.id}`, { isActive: true });
        console.log(`🟢 Copiloto LIGADO — responde só no canal interno.`);
      }
    }
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`Pronto: ${TOOLS.length} tools + ${SKILLS.length} skills semeadas na org ${orgId}.`);
  if (!agentName) {
    console.log('Próximo passo: atribua as skills a um agente interno na UI');
    console.log('(ou reexecute com COPILOT_AGENT="<nome do agente>").');
  }
  console.log('Infra: reaproveita OFP_BASE_URL / OFP_API_KEY / DATABASE_URL que a API já tem (nada novo no VPS).');
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
