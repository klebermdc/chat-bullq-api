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
import {
  mapLegacyBlockedDate,
  mapLegacyContract,
} from '../src/modules/contracts/legacy/legacy-contract.mapper';


const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const BATCH = 25;
const DRY_RUN_ORG = 'dry-run-org';

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
}

const MARKER = '/contract-documents/';

function legacyPath(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(MARKER);
  return at < 0 ? null : decodeURIComponent(url.slice(at + MARKER.length).split('?')[0]);
}

const MAX_BODY_IN_ERROR = 200;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** HTTPS obrigatório, exceto localhost/127.0.0.1 (nunca mandar senha/token em claro). */
function assertSafeApiUrl(apiUrl: string): void {
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(apiUrl);
  if (!apiUrl.startsWith('https://') && !isLocal) {
    throw new Error('API_URL precisa começar com https:// (http só para localhost/127.0.0.1)');
  }
}

/**
 * fetch com até 3 tentativas (espera 1s, 2s) só para erro de rede, 5xx e 429.
 * Erros mostram apenas método, rota e status, com no máximo 200 chars do corpo.
 * `makeInit` é uma função porque FormData/Blob não se reutilizam entre tentativas.
 */
async function requestText(
  method: string,
  url: string,
  label: string,
  makeInit: () => RequestInit,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | undefined;
    let text = '';
    try {
      res = await fetch(url, { ...makeInit(), method });
      text = await res.text();
    } catch {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`${method} ${label} → falha de rede`);
    }
    if (res?.ok) return text;
    if (res) {
      const retry = isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS;
      if (!retry) {
        throw new Error(`${method} ${label} → ${res.status}: ${text.slice(0, MAX_BODY_IN_ERROR)}`);
      }
    }
    await sleep(1000 * attempt);
  }
}

interface LoginOrg {
  id: string;
  name?: string;
  role?: string;
}

/** Escolhe a org e confere que existe no login e que o usuário é OWNER nela. */
function pickOrganization(orgs: LoginOrg[], forced: string): LoginOrg {
  const list = orgs.map((o) => `  ${o.id}  ${o.name ?? ''}`).join('\n');
  if (!forced && orgs.length > 1) {
    throw new Error(`Há ${orgs.length} organizações; informe ORG_ID=...:\n${list}`);
  }
  const org = forced ? orgs.find((o) => o.id === forced) : orgs[0];
  if (!org) {
    throw new Error(
      forced ? `ORG_ID não está entre as organizações do login:\n${list}` : 'login sem organização',
    );
  }
  if (org.role !== 'OWNER') {
    throw new Error(`Usuário precisa ser OWNER na organização ${org.id} (papel atual: ${org.role ?? '?'})`);
  }
  return org;
}

async function login(apiUrl: string): Promise<{ headers: Record<string, string>; orgLabel: string }> {
  const email = (process.env.EMAIL || '').trim();
  const password = process.env.PASSWORD || '';
  if (!email || !password) throw new Error('Faça login: EMAIL=... PASSWORD=...');
  const text = await requestText('POST', `${apiUrl}/auth/login`, 'auth/login', () => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('POST auth/login → corpo não-JSON');
  }
  const token = j.accessToken || j?.data?.accessToken;
  const orgs: LoginOrg[] = j.organizations || j?.data?.organizations || [];
  if (!token) throw new Error('login sem token');
  const org = pickOrganization(orgs, (process.env.ORG_ID || '').trim());
  return {
    headers: { Authorization: `Bearer ${token}`, 'x-organization-id': org.id },
    orgLabel: `${org.id} ${org.name ?? ''}`.trim(),
  };
}

type Headers = Record<string, string>;

async function call(apiUrl: string, headers: Headers, method: string, path: string, makeInit: () => RequestInit) {
  const route = `contracts/legacy-import/${path}`;
  const text = await requestText(method, `${apiUrl}/${route}`, route, () => {
    const init = makeInit();
    return { ...init, headers: { ...headers, ...(init.headers as Headers | undefined) } };
  });
  // A API embrulha toda resposta em { data, meta } (interceptor global).
  const body = JSON.parse(text);
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Envia `rows` em lotes de BATCH linhas (contratos e datas bloqueadas). */
async function postInBatches(apiUrl: string, headers: Headers, path: string, rows: unknown[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const body = JSON.stringify({ rows: rows.slice(i, i + BATCH) });
    await call(apiUrl, headers, 'POST', path, () => ({ headers: JSON_HEADERS, body }));
  }
}

/** Valida todas as linhas com o próprio mapper; devolve só ids/índices e a regra, sem dados pessoais. */
function validateRows(contracts: any[], blocked: any[]): string[] {
  const problems: string[] = [];
  for (const [i, c] of contracts.entries()) {
    try {
      mapLegacyContract(DRY_RUN_ORG, c);
    } catch (err) {
      problems.push(`contrato ${typeof c?.id === 'string' ? c.id : `#${i}`}: ${(err as Error).message}`);
    }
  }
  for (const [i, b] of blocked.entries()) {
    try {
      mapLegacyBlockedDate(DRY_RUN_ORG, b);
    } catch (err) {
      problems.push(`data bloqueada #${i}: ${(err as Error).message}`);
    }
  }
  return problems;
}

async function main() {
  const dir = (process.env.BACKUP_DIR || '').replace(/^~/, process.env.HOME || '');
  const apiUrl = (process.env.API_URL || '').replace(/\/$/, '');
  if (!dir || !existsSync(join(dir, 'contracts.json'))) throw new Error('BACKUP_DIR inválido');
  if (!apiUrl) throw new Error('Falta API_URL');
  assertSafeApiUrl(apiUrl);

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

  const invalid = validateRows(contracts, blocked);
  console.log(`Validação local (mapper): ${invalid.length} linhas inválidas.`);
  for (const line of invalid.slice(0, 50)) console.log(`  ${line}`);
  if (invalid.length) throw new Error('Há linhas inválidas; corrija o backup/regras antes de gravar.');
  if (!APPLY) {
    console.log('DRY-RUN: nada gravado. Rode com APPLY=1 para importar.');
    return;
  }

  const { headers, orgLabel } = await login(apiUrl);
  console.log(`Gravando em: org ${orgLabel} | API_URL ${apiUrl}`);

  let stored = 0;
  let existed = 0;
  for (const [i, p] of files.entries()) {
    const bytes = readFileSync(join(dir, 'files', p));
    const r = await call(apiUrl, headers, 'POST', 'files', () => {
      const form = new FormData();
      form.append('path', p);
      form.append('file', new Blob([bytes]), basename(p));
      return { body: form };
    });
    r.status === 'stored' ? stored++ : existed++;
    if ((i + 1) % 50 === 0) console.log(`  arquivos ${i + 1}/${files.length}`);
  }
  console.log(`Arquivos: ${stored} gravados, ${existed} já existiam.`);

  await postInBatches(apiUrl, headers, 'contracts', contracts);
  await postInBatches(apiUrl, headers, 'blocked-dates', blocked);
  if (settings[0]?.contract_terms) {
    const body = JSON.stringify({ terms: settings[0].contract_terms });
    await call(apiUrl, headers, 'POST', 'settings', () => ({ headers: JSON_HEADERS, body }));
  }

  const status = await call(apiUrl, headers, 'GET', 'status', () => ({}));
  console.log('Sendtur agora:', status);
  const withFiles = contracts.filter(
    (c) => c.signature_url || c.signed_contract_url || c.payment_receipt_url,
  ).length;
  const uniqueBlocked = new Set(blocked.map((b) => `${b.guide_name}|${b.blocked_date}`)).size;
  const ok =
    status.contracts === contracts.length &&
    status.blockedDates === uniqueBlocked &&
    status.contractsWithFiles === withFiles;
  console.log(ok ? '✅ Contagens batem com o backup.' : '❌ Contagens NÃO batem — investigar.');
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
