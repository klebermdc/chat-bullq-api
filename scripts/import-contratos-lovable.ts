export {}; // isola o escopo do módulo

/**
 * Importa o backup do app de contratos do Lovable para o Sendtur, por HTTP.
 * Lê a pasta gerada pelo backup (contracts.json, blocked_dates.json,
 * app_settings.json, files/ e files_index.json).
 *
 * Idempotente: tudo é upsert. Rodar de novo na virada só traz o que mudou.
 * Os arquivos sobem antes dos contratos, para nenhum contrato apontar para
 * chave inexistente.
 *
 *   BACKUP_DIR=~/dev/backups/contratos-lovable-20261015 \
 *   API_URL=https://sendtur.com.br/api/v1 EMAIL=... PASSWORD=... \
 *     npx ts-node scripts/import-contratos-lovable.ts
 *
 * DRY-RUN por padrão (só confere o backup e mostra contagens). Para gravar: APPLY=1.
 */
import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const BATCH = 25;

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
}

const MARKER = '/contract-documents/';

function legacyPath(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(MARKER);
  return at < 0 ? null : decodeURIComponent(url.slice(at + MARKER.length).split('?')[0]);
}

async function login(apiUrl: string): Promise<{ headers: Record<string, string>; orgLabel: string }> {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  if (!email || !password) throw new Error('Faça login: EMAIL=... PASSWORD=...');
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`login → ${res.status}: ${text.slice(0, 300)}`);
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`login devolveu corpo não-JSON: ${text.slice(0, 300)}`);
  }
  const token = j.accessToken || j?.data?.accessToken;
  const orgs: any[] = j.organizations || j?.data?.organizations || [];
  const forced = (process.env.ORG_ID || '').trim();
  if (!forced && orgs.length > 1) {
    const list = orgs.map((o) => `  ${o.id}  ${o.name ?? o.organization?.name ?? ''}`).join('\n');
    throw new Error(`Há ${orgs.length} organizações; informe ORG_ID=...:\n${list}`);
  }
  const orgId = forced || orgs[0]?.id;
  if (!token || !orgId) throw new Error('login sem token/org');
  const match = orgs.find((o) => o.id === orgId);
  const orgLabel = `${orgId} ${match?.name ?? match?.organization?.name ?? ''}`.trim();
  return { headers: { Authorization: `Bearer ${token}`, 'x-organization-id': orgId }, orgLabel };
}

async function call(apiUrl: string, headers: Record<string, string>, path: string, init: RequestInit) {
  const res = await fetch(`${apiUrl}/contracts/legacy-import/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const dir = (process.env.BACKUP_DIR || '').replace(/^~/, process.env.HOME || '');
  const apiUrl = (process.env.API_URL || '').replace(/\/$/, '');
  if (!dir || !existsSync(join(dir, 'contracts.json'))) throw new Error('BACKUP_DIR inválido');
  if (!apiUrl) throw new Error('Falta API_URL');

  const contracts = readJson<any[]>(dir, 'contracts.json');
  const blocked = readJson<any[]>(dir, 'blocked_dates.json');
  const settings = readJson<any[]>(dir, 'app_settings.json');
  const files = readJson<string[]>(dir, 'files_index.json');

  // Conferência local: todo arquivo citado por contrato tem que estar no backup.
  const index = new Set(files);
  const referenced = contracts.flatMap((c) =>
    [c.signature_url, c.signed_contract_url, c.payment_receipt_url].map(legacyPath).filter(Boolean),
  ) as string[];
  const missing = referenced.filter((p) => !index.has(p) || !existsSync(join(dir, 'files', p)));
  console.log(
    `Backup: ${contracts.length} contratos, ${blocked.length} datas, ${settings.length} termos, ` +
      `${files.length} arquivos (${referenced.length} citados, ${missing.length} faltando).`,
  );
  if (missing.length) throw new Error(`Arquivos faltando: ${missing.slice(0, 5).join(', ')}`);
  if (!APPLY) {
    console.log('DRY-RUN: nada gravado. Rode com APPLY=1 para importar.');
    return;
  }

  const { headers, orgLabel } = await login(apiUrl);
  console.log(`Gravando em: org ${orgLabel} | API_URL ${apiUrl}`);

  let stored = 0;
  let existed = 0;
  for (const [i, p] of files.entries()) {
    const form = new FormData();
    form.append('path', p);
    form.append('file', new Blob([readFileSync(join(dir, 'files', p))]), basename(p));
    const r = await call(apiUrl, headers, 'files', { method: 'POST', body: form });
    r.status === 'stored' ? stored++ : existed++;
    if ((i + 1) % 50 === 0) console.log(`  arquivos ${i + 1}/${files.length}`);
  }
  console.log(`Arquivos: ${stored} gravados, ${existed} já existiam.`);

  const json = { 'Content-Type': 'application/json' };
  for (let i = 0; i < contracts.length; i += BATCH) {
    await call(apiUrl, headers, 'contracts', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ rows: contracts.slice(i, i + BATCH) }),
    });
  }
  await call(apiUrl, headers, 'blocked-dates', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ rows: blocked }),
  });
  if (settings[0]?.contract_terms) {
    await call(apiUrl, headers, 'settings', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ terms: settings[0].contract_terms }),
    });
  }

  const status = await call(apiUrl, headers, 'status', { method: 'GET' });
  console.log('Sendtur agora:', status);
  const withFiles = contracts.filter(
    (c) => c.signature_url || c.signed_contract_url || c.payment_receipt_url,
  ).length;
  const ok =
    status.contracts === contracts.length &&
    status.blockedDates === blocked.length &&
    status.contractsWithFiles === withFiles;
  console.log(ok ? '✅ Contagens batem com o backup.' : '❌ Contagens NÃO batem — investigar.');
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
