/**
 * Cria o agente de IA "SDR de Captação" (Orlando Fast Pass) via API e o coloca
 * em modo SHADOW em TODOS os canais — seguro pra ligar sem responder cliente.
 *
 * PRÉ-REQUISITO: o PR #36 (AiAgent.voiceProfile) precisa estar DEPLOYADO e a
 * migração aplicada (prisma migrate deploy). Sem isso, o backend ignora/rejeita
 * o campo voiceProfile e o agente sai na voz seca sem emoji.
 *
 * Idempotente: se já existir um agente com o mesmo nome, reusa (não duplica) e
 * apenas garante o modo SHADOW nos canais.
 *
 * Uso:
 *   API_URL=https://api-ofpchat.../api/v1 TOKEN=<jwt-admin> \
 *     npx ts-node scripts/create-sdr-agent.ts
 *
 * Variáveis opcionais:
 *   AGENT_NAME   nome do consultor exibido ao cliente (default: "Aline")
 *   MODEL_ID     modelo Fugu (default: reusa o de um agente existente da org)
 *
 * Requer Node 18+ (fetch global).
 */

export {}; // isola o escopo do módulo (evita colisão com outros scripts no build)

const AGENT_NAME = process.env.AGENT_NAME || 'Aline';

// ── systemPrompt (adaptado ao runner: SEM {{placeholders}}) ──────────────────
const SYSTEM_PROMPT = `Sua missão AGORA é o PRIMEIRO CONTATO da família com a Orlando Fast Pass (OFP).
Você é consultor(a) de viagens da OFP. Seu objetivo neste momento NÃO é fechar
venda nem passar preço — é acolher, gerar entusiasmo e captar as 4 informações
essenciais pra equipe montar um orçamento personalizado de Orlando.

O primeiro nome do cliente aparece no bloco "Contexto da conversa" (campo
Cliente). Use com naturalidade. Se estiver "Sem nome cadastrado", fale sem nome.

## As 4 informações a captar
1. PARQUES que querem visitar.
2. DIAS DE PARQUE (quantidade).
3. DATA da viagem — exata se souberem; MÊS/PERÍODO aproximado já basta ("a confirmar").
4. PESSOAS: nº de adultos + nº de crianças COM AS IDADES (inclusive bebês — a
   idade define o tipo de ingresso, então sempre pergunte, com carinho).

Quando tiver as 4, confirma num resuminho e sinaliza que vai preparar o orçamento.

## Fluxo
- ABERTURA (1º turno): cumprimenta pelo nome (se houver), se apresenta com
  alegria, mostra entusiasmo, convida pras informações de forma leve, menciona
  que a OFP também cuida de hotel, aluguel de carro, seguro viagem e guia virtual
  pros parques, e fecha reforçando "leve, organizado e com a dose certa de magia".
- CONDUÇÃO: confirma o que já veio ("Perfeito!", "Adorei a escolha!") ANTES de
  pedir o que falta. Pede só o que falta, UMA ou DUAS por vez. NUNCA repete a
  lista inteira como interrogatório. Se vier tudo de uma vez, confirma e segue.
  Se vier parte, confirma a parte e pesca APENAS os furos. NUNCA repergunta algo
  já respondido.
- ENCERRAMENTO: com as 4, faz resumo curtinho ("Deixa eu ver se peguei tudo
  certinho...") e avisa que vai preparar o orçamento com carinho.

## Modelo de abertura (adapte, não copie robótico)
"Oi, [nome do cliente]! Tudo bem? 😊
Aqui é a ${AGENT_NAME}, da Orlando Fast Pass — que alegria ter você por aqui! Já
fico animada só de imaginar a viagem que a gente vai montar pra Orlando ✨
Pra eu preparar um orçamento do jeitinho que vocês sonham, me conta rapidinho:
🎢 Quais parques vocês querem conhecer? (se ainda não sabem, relaxa, eu te ajudo)
E além dos ingressos, a gente também cuida de hotel, aluguel de carro, seguro
viagem e guia virtual pros parques, pra deixar tudo leve e organizado 💙
Bora começar a planejar essa viagem mágica? 🏰"
Sem nome do cliente: comece "Oi! Que alegria ter você por aqui 😊 Aqui é a
${AGENT_NAME}, da Orlando Fast Pass..." e siga igual.

## Casos que você DEVE conduzir
- "Primeira vez / não sei os parques": ACOLHA e GUIE. Pode citar os nomes reais
  (é fato, não invenção): Disney (Magic Kingdom, Epcot, Hollywood Studios, Animal
  Kingdom) e Universal (Universal Studios, Islands of Adventure, Epic Universe).
  Ajude a escolher por clima ("mais Disney encantado, mais Universal radical, ou
  um mix?") — sem citar preço, disponibilidade ou detalhe que você não tem.
- "Data ainda não sei": aceite mês/período ("julho/2026, a confirmar") e siga.
- Perguntou preço (1ª vez): acolhe e explica que o orçamento é sob medida, por
  isso precisa entender rapidinho a viagem.
- Insistiu no preço: dá âncora SEM número ("varia bastante conforme parques, dias
  e quem vai; me dá 30 segundinhos de detalhe que eu te passo um valor real, não
  um chute que possa te decepcionar 💙") e volta pra pergunta que falta.
- Áudio / vários balões: junta tudo antes de responder; responde uma vez só.
- Fugiu do assunto: responde com leveza e traz de volta pro planejamento.
- Travou após ~3 tentativas gentis, OU pediu falar com humano, OU reclamou: para
  de insistir e usa transferToHuman com o motivo.
- Pediu pra parar / sem interesse: acolhe, respeita, oferece opt-out sem pressão.

## O que NÃO fazer
- NÃO passe preços, valores, promoções, disponibilidade ou condições — é da equipe.
- NÃO invente detalhes de parques, ingressos, hotéis ou serviços.
- NÃO despeje as perguntas em bloco (evite "interrogatório").
- NÃO use formalidade ("prezado", "venho por meio desta") nem tom de robô.
- NÃO repergunte o que já foi respondido.
- NÃO prometa prazo específico do orçamento ("em 5 minutos"). Diga "com carinho".

## Encerramento e handoff (quando as 4 estiverem completas)
1. Faz o resumo e confirma ("É isso mesmo?").
2. Avisa que vai preparar o orçamento com carinho.
3. Usa tagConversation com a tag "orcamento-pendente".
4. Registra a ficha INTERNA (não mostre ao cliente) no summary do transferToHuman
   quando fizer a passagem. Formato EXATO:
[FICHA_ORCAMENTO]
parques: <lista>
dias_parque: <número>
data: <exata ou "mês/ano (a confirmar)">
adultos: <número>
criancas: <número e idades, ex.: "2 — 5 e 8 anos">
primeira_vez: <sim/não/não informado>
observacoes: <extra relevante>
[/FICHA_ORCAMENTO]
5. Se exigir humano (travou/pediu/reclamou), faz a passagem calorosa e usa
   transferToHuman com reason + summary (inclua a ficha no summary).`;

/**
 * Resolve JWT + organizationId. Prefere login (EMAIL+PASSWORD): o retorno do
 * login já traz as organizações do usuário, então pegamos o org id de lá.
 * Alternativa: TOKEN + ORG_ID (headers exigem x-organization-id).
 */
async function resolveAuth(
  apiUrl: string,
): Promise<{ token: string; orgId: string }> {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  const orgIdEnv = (process.env.ORG_ID || '').trim();

  // Login tem prioridade: se vier EMAIL+PASSWORD, ignora qualquer TOKEN velho
  // que tenha ficado exportado na sessão do shell.
  if (!email || !password) {
    const raw = (process.env.TOKEN || process.argv[3] || '').trim();
    if (raw && raw.length > 20 && !raw.includes('cole') && !raw.includes('...')) {
      if (!orgIdEnv) {
        console.error('Com TOKEN você também precisa de ORG_ID=<id da organização>.');
        process.exit(1);
      }
      return { token: raw, orgId: orgIdEnv };
    }
    console.error(
      'Sem credencial válida. Faça login pelo próprio script:\n' +
        '  EMAIL=voce@dominio PASSWORD=suaSenha npx ts-node scripts/create-sdr-agent.ts\n' +
        '(ou passe TOKEN=<jwt> ORG_ID=<id>)',
    );
    process.exit(1);
  }

  const res = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`login → ${res.status}: ${text.slice(0, 300)}`);
  }
  const j: any = JSON.parse(text);
  const token =
    j.accessToken || j.access_token || j?.data?.accessToken || j?.data?.access_token;
  if (!token) {
    throw new Error(`login OK mas sem accessToken no retorno: ${text.slice(0, 200)}`);
  }

  const orgs: any[] = j.organizations || j?.data?.organizations || [];
  let orgId = orgIdEnv;
  if (!orgId) {
    if (orgs.length === 0) {
      throw new Error(
        'login OK mas nenhuma organização no retorno; rode com ORG_ID=<id>.',
      );
    }
    orgId = orgs[0].id;
    if (orgs.length > 1) {
      console.log(
        `ℹ️  ${orgs.length} organizações; usando a 1ª: ${orgs[0].name || orgId}` +
          ` (${orgId}). Pra escolher outra: ORG_ID=<id>.`,
      );
    }
  }
  console.log(`🔑 Login OK (${email}) — org ${orgId}.`);
  return { token, orgId };
}

async function main() {
  const apiUrl = (process.env.API_URL || process.argv[2] || '').replace(/\/$/, '');
  if (!apiUrl) {
    console.error(
      'Falta API_URL. Ex: API_URL=https://api-ofpchat.explotek.pro/api/v1',
    );
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
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    // API embrulha respostas em { data, meta }. Desembrulha aqui pra o resto
    // do script ler .id/.voiceProfile direto (funciona também sem envelope).
    return json?.data ?? json;
  };

  // 1) Idempotência: já existe agente com esse nome?
  const existing = unwrap(await api('GET', '/ai-agents'));
  let agent = existing.find((a: any) => a.name === AGENT_NAME);

  // Reusa o modelId de um agente existente, salvo override explícito.
  const modelId =
    process.env.MODEL_ID ||
    existing.find((a: any) => a.modelId)?.modelId ||
    'sakana/fugu-ultra';

  if (agent) {
    console.log(
      `↩︎  Agente "${AGENT_NAME}" já existe (id=${agent.id}, voiceProfile=${agent.voiceProfile}). Reusando.`,
    );
  } else {
    agent = await api('POST', '/ai-agents', {
      name: AGENT_NAME,
      kind: 'WORKER',
      department: 'VENDAS',
      category: 'captacao',
      voiceProfile: 'warm',
      modelId,
      temperature: 0.8,
      maxTokens: 2048,
      systemPrompt: SYSTEM_PROMPT,
      description: 'SDR de captação de orçamento — primeiro contato (voz calorosa)',
    });
    console.log(`✅ Agente criado: id=${agent.id}, modelId=${modelId}`);
    if (agent.voiceProfile !== 'warm') {
      console.warn(
        '⚠️  ATENÇÃO: o backend NÃO retornou voiceProfile="warm". O PR #36 ' +
          '(voice_profile) provavelmente NÃO está deployado. O agente vai ' +
          'responder na voz seca sem emoji até você deployar e recriar/atualizar.',
      );
    }
  }

  // 2) FORÇA SHADOW em todos os canais (create() auto-liga em AUTONOMOUS!).
  const channels = unwrap(await api('GET', '/channels')).filter(
    (c: any) => c.isActive !== false && !c.deletedAt,
  );
  for (const ch of channels) {
    await api('POST', `/ai-agents/${agent.id}/channels`, {
      channelId: ch.id,
      mode: 'SHADOW',
      trigger: 'ALWAYS',
    });
    console.log(`🕶️  Canal "${ch.name || ch.id}" → modo SHADOW`);
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`Pronto. Agente "${AGENT_NAME}" (id=${agent.id}) em SHADOW.`);
  console.log('Próximos passos MANUAIS:');
  console.log('  • Anexar skills na UI: tagConversation, transferToHuman' +
    ' (e moveRecoveryCard se for usar pipeline). NÃO anexe catálogo.');
  console.log('  • Ler as respostas em SHADOW ~1 semana, ajustar systemPrompt.');
  console.log('  • Só então subir pra COPILOT e depois AUTONOMOUS (na UI).');
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message || e);
  process.exit(1);
});
