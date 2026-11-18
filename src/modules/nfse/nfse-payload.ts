/** Corpo do POST /nfse/enviar, já validado e normalizado. */
export interface NfsePayload {
  envioId: string;
  /** Só dígitos, com DDI 55 (12 ou 13 dígitos). */
  telefone: string;
  nome: string;
  numeroNfse: string;
  valor: number;
  pdfUrl: string;
  pdfNome: string;
}

export type ParseResult = { ok: true; value: NfsePayload } | { ok: false; error: string };

const BR_DDI = '55';
/** 55 + DDD + fixo (8) ou celular (9 + 8). */
const BR_PHONE = /^55[1-9][1-9](9\d{8}|\d{8})$/;
/** DDD + número sem o 55: fixo de 10 dígitos ou celular com 9 na 3ª posição. */
const BR_NATIONAL = /^[1-9][1-9](9\d{8}|\d{8})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 120;
const MAX_NUMERO = 30;
const MAX_FILE_NAME = 150;
const MAX_URL = 2048;
const MAX_VALOR = 10_000_000;
const PDF_EXT = '.pdf';

function fail(error: string): ParseResult {
  return { ok: false, error };
}

function text(body: Record<string, unknown>, field: string, max: number): string | null {
  const raw = body[field];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value && value.length <= max ? value : null;
}

/** Só dígitos; sem 55 e com 10/11 dígitos, acrescenta o DDI. */
function parsePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const digits = raw.trim();
  const withDdi = BR_NATIONAL.test(digits) ? BR_DDI + digits : digits;
  return BR_PHONE.test(withDdi) ? withDdi : null;
}

function parseNumero(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return String(raw);
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value && value.length <= MAX_NUMERO ? value : null;
}

function parseValor(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw > 0 && raw <= MAX_VALOR ? raw : null;
}

function parsePdfUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Nome que o cliente vê no WhatsApp: sem pasta nem caractere de controle, termina em .pdf. */
function cleanFileName(raw: string): string {
  const base = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]+/g, '_')
    .replace(/^[._]+/, '')
    .trim();
  const name = base || 'NFS-e';
  return name.toLowerCase().endsWith(PDF_EXT) ? name : name + PDF_EXT;
}

export function parseNfsePayload(input: unknown): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('Corpo inválido: envie um objeto JSON.');
  }
  const body = input as Record<string, unknown>;

  const envioId = text(body, 'envioId', 64);
  if (!envioId || !UUID.test(envioId)) return fail('envioId: obrigatório, no formato uuid.');

  if (typeof body.telefone !== 'string' || !body.telefone.trim()) {
    return fail('telefone: obrigatório.');
  }
  if (!/^\d+$/.test(body.telefone.trim())) return fail('telefone: use só dígitos, com DDI 55.');
  const telefone = parsePhone(body.telefone);
  if (!telefone) return fail('telefone: precisa ter 12 ou 13 dígitos com o DDI 55.');

  const nome = text(body, 'nome', MAX_NAME);
  if (!nome) return fail(`nome: obrigatório, até ${MAX_NAME} caracteres.`);

  const numeroNfse = parseNumero(body.numeroNfse);
  if (!numeroNfse) return fail(`numeroNfse: obrigatório, até ${MAX_NUMERO} caracteres.`);

  const valor = parseValor(body.valor);
  if (valor === null) return fail('valor: obrigatório, número maior que zero (ex.: 1800.48).');

  const pdfUrl = parsePdfUrl(body.pdfUrl);
  if (!pdfUrl) return fail('pdfUrl: obrigatório, um link https válido.');

  const pdfNomeRaw = text(body, 'pdfNome', MAX_FILE_NAME);
  if (!pdfNomeRaw) return fail(`pdfNome: obrigatório, até ${MAX_FILE_NAME} caracteres.`);

  return {
    ok: true,
    value: { envioId, telefone, nome, numeroNfse, valor, pdfUrl, pdfNome: cleanFileName(pdfNomeRaw) },
  };
}
