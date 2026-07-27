export {}; // isola o escopo do módulo

/**
 * Backfill: põe no funil de vendas, na etapa de entrada ("Lead"), toda conversa
 * ABERTA que ainda não tem card em nenhum pipeline — ou seja, o que está parado
 * na Aline hoje. Complemento one-shot do `LeadCardService`, que passa a criar o
 * card na entrada de toda conversa nova.
 *
 * Nunca move card existente: conversa já no funil (qualquer etapa, qualquer
 * pipeline) é pulada. Idempotente — rodar de novo não duplica.
 *
 * Roda no MAC (não na VPS), só HTTP — sem acesso ao banco:
 *   API_URL=https://sendtur.com.br/api/v1 EMAIL=admin@... PASSWORD=... \
 *     npx ts-node scripts/backfill-lead-cards.ts
 *
 * Sai em DRY-RUN por padrão (só lista o que faria). Pra gravar de verdade:
 *   APPLY=1 API_URL=... EMAIL=... PASSWORD=... npx ts-node scripts/backfill-lead-cards.ts
 *
 * Opcionais: PIPELINE_NAME (default "vendas"), STAGE_NAME (default "lead"),
 * MAX_DAYS (só conversas com atividade nos últimos N dias), PAGE_SIZE (100),
 * CHANNEL_NAME (só conversas de um canal, match por trecho do nome) ou
 * CHANNEL_ID (id exato, tem precedência).
 */

const PIPELINE_MATCH = (process.env.PIPELINE_NAME || 'vendas').toLowerCase();
const STAGE_MATCH = (process.env.STAGE_NAME || 'lead').toLowerCase();
const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 100);
const MAX_DAYS = process.env.MAX_DAYS ? Number(process.env.MAX_DAYS) : null;
const CHANNEL_MATCH = (process.env.CHANNEL_NAME || '').toLowerCase().trim();
const CHANNEL_ID = (process.env.CHANNEL_ID || '').trim();

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
    if (!res.ok) {
      const err: any = new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return j?.data ?? j;
  };

  // ── 1. Funil + etapa de entrada ───────────────────────────────
  const pipelines: any[] = await api('GET', '/pipelines');
  const pipeline = pipelines.find((p) =>
    (p.name ?? '').toLowerCase().includes(PIPELINE_MATCH),
  );
  if (!pipeline) {
    throw new Error(
      `Nenhum funil com nome contendo "${PIPELINE_MATCH}". Funis: ${pipelines
        .map((p) => p.name)
        .join(', ')}`,
    );
  }

  const board = await api('GET', `/pipelines/${pipeline.id}/board`);
  const stages: any[] = board.stages ?? [];
  const stage =
    stages.find((s) => (s.name ?? '').toLowerCase().includes(STAGE_MATCH)) ??
    stages[0];
  if (!stage) throw new Error(`Funil "${pipeline.name}" está sem etapas.`);
  console.log(`📋 Funil "${pipeline.name}" → etapa de entrada "${stage.name}".`);

  // ── 2. Quem JÁ está em algum funil (não pode voltar pra Lead) ──
  const withCard = new Set<string>();
  for (const p of pipelines) {
    const b = p.id === pipeline.id ? board : await api('GET', `/pipelines/${p.id}/board`);
    for (const list of Object.values(b.cards ?? {}) as any[][]) {
      for (const card of list) {
        if (card.conversationId) withCard.add(card.conversationId);
      }
    }
  }
  console.log(`🃏 ${withCard.size} conversas já têm card (serão puladas).`);

  // ── 2b. Canal (opcional) ──────────────────────────────────────
  let channelId = CHANNEL_ID;
  if (!channelId && CHANNEL_MATCH) {
    const channels: any[] = await api('GET', '/channels');
    const hits = channels.filter((c) =>
      (c.name ?? '').toLowerCase().includes(CHANNEL_MATCH),
    );
    if (hits.length === 0) {
      throw new Error(
        `Nenhum canal com nome contendo "${CHANNEL_MATCH}". Canais: ${channels
          .map((c) => c.name)
          .join(' | ')}`,
      );
    }
    if (hits.length > 1) {
      throw new Error(
        `"${CHANNEL_MATCH}" casou ${hits.length} canais: ${hits
          .map((c) => `${c.name} (${c.id})`)
          .join(' | ')}. Use CHANNEL_ID pra escolher.`,
      );
    }
    channelId = hits[0].id;
    console.log(`📡 Canal "${hits[0].name}" (${channelId}).`);
  }

  // ── 3. Conversas abertas sem card ─────────────────────────────
  // Sem filtro `status` a API devolve tudo que não está CLOSED; `groups=exclude`
  // tira os grupos (grupo não é lead).
  const dateFrom = MAX_DAYS
    ? new Date(Date.now() - MAX_DAYS * 86_400_000).toISOString()
    : null;

  const pending: { id: string; title: string }[] = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const qs = new URLSearchParams({
      groups: 'exclude',
      archived: 'exclude',
      page: String(page),
      limit: String(PAGE_SIZE),
      ...(dateFrom ? { dateFrom } : {}),
      ...(channelId ? { channelId } : {}),
    });
    const res = await api('GET', `/conversations?${qs}`);
    const list: any[] = res.conversations ?? [];
    total = res.pagination?.total ?? total;
    for (const c of list) {
      if (withCard.has(c.id)) continue;
      pending.push({
        id: c.id,
        title: c.contact?.name || c.contact?.phone || c.id,
      });
    }
    const totalPages = res.pagination?.totalPages ?? 1;
    if (page >= totalPages || list.length === 0) break;
    page += 1;
  }
  console.log(
    `🔎 ${total} conversas abertas varridas → ${pending.length} sem card.`,
  );

  if (!pending.length) {
    console.log('✅ Nada a fazer.');
    return;
  }

  if (!APPLY) {
    for (const c of pending.slice(0, 20)) console.log(`   · ${c.title} (${c.id})`);
    if (pending.length > 20) console.log(`   … +${pending.length - 20}`);
    console.log(
      `\n🧪 DRY-RUN: nada foi gravado. Rode com APPLY=1 pra criar os ${pending.length} cards em "${stage.name}".`,
    );
    return;
  }

  // ── 4. Cria os cards ──────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const c of pending) {
    try {
      await api('POST', `/pipelines/${pipeline.id}/cards`, {
        conversationId: c.id,
        stageId: stage.id,
      });
      created += 1;
      if (created % 25 === 0) console.log(`   … ${created}/${pending.length}`);
    } catch (e: any) {
      // 400 = "essa conversa já está no pipeline" (corrida com o runtime).
      if (e?.status === 400) skipped += 1;
      else {
        failed += 1;
        console.warn(`   ⚠️  ${c.title} (${c.id}): ${e?.message ?? e}`);
      }
    }
  }
  console.log(
    `\n✅ Backfill concluído: ${created} cards criados em "${stage.name}", ${skipped} já existiam, ${failed} falharam.`,
  );
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
