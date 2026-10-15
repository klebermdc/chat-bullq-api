import type { Prisma } from '@prisma/client';
import {
  LEGACY_BUCKET_MARKER,
  type LegacyBlockedDateRow,
  type LegacyContractRow,
} from './legacy.types';

const MAX_TEXT = 2000;
const MAX_LONG_TEXT = 10_000;
const MAX_COUNT = 10_000;
const MAX_PATH = 400;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const REQUIRED_TEXT = ['id', 'nome_completo', 'cpf', 'nome_guia', 'valor', 'created_at'] as const;
const OPTIONAL_TEXT = [
  'endereco',
  'cep',
  'email',
  'telefone',
  'vendedor',
  'pix_key',
  'umbler_chat_url',
  'acceptance_token',
  'client_ip',
  'signature_url',
  'signed_contract_url',
  'payment_receipt_url',
] as const;
const LONG_TEXT = ['datas_requeridas', 'client_user_agent'] as const;
const COUNTS = ['quantidade_dias', 'quantidade_pessoas'] as const;
const FLAGS = ['hospede_disney', 'comprado', 'pago', 'nf_emitida'] as const;

function isValidDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

/** Valida o tipo de cada campo; o erro cita o id da linha e nunca o valor. */
function validateContractRow(row: LegacyContractRow): void {
  const id = typeof row.id === 'string' && row.id ? row.id : '(sem id)';
  const bad = (field: string, why: string): never => {
    throw new Error(`Contrato ${id}: campo ${field} ${why}`);
  };
  const record = row as unknown as Record<string, unknown>;

  for (const f of REQUIRED_TEXT) {
    const v = record[f];
    if (typeof v !== 'string' || v === '') bad(f, 'obrigatório (texto não vazio)');
    if ((v as string).length > MAX_TEXT) bad(f, `excede ${MAX_TEXT} caracteres`);
  }
  const optional: [readonly string[], number][] = [
    [OPTIONAL_TEXT, MAX_TEXT],
    [LONG_TEXT, MAX_LONG_TEXT],
  ];
  for (const [fields, max] of optional) {
    for (const f of fields) {
      const v = record[f];
      if (v === null || v === undefined) continue;
      if (typeof v !== 'string') bad(f, 'deve ser texto');
      if ((v as string).length > max) bad(f, `excede ${max} caracteres`);
    }
  }
  for (const f of COUNTS) {
    const v = record[f];
    if (f === 'quantidade_pessoas' && (v === null || v === undefined)) continue;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_COUNT) {
      bad(f, `deve ser inteiro entre 0 e ${MAX_COUNT}`);
    }
  }
  for (const f of FLAGS) {
    if (typeof record[f] !== 'boolean') bad(f, 'deve ser booleano');
  }
  if (!isValidDate(row.created_at)) bad('created_at', 'não é data válida');
  if (row.accepted_at !== null && row.accepted_at !== undefined && !isValidDate(row.accepted_at)) {
    bad('accepted_at', 'não é data válida');
  }
}

/** Caminho do arquivo dentro do bucket `contract-documents`, decodificado. */
export function legacyPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(LEGACY_BUCKET_MARKER);
  if (at < 0) return null;
  const raw = url.slice(at + LEGACY_BUCKET_MARKER.length).split('?')[0];
  return raw ? decodeURIComponent(raw) : null;
}

export function storageKeyFor(organizationId: string, legacyPath: string): string {
  const invalid =
    typeof legacyPath !== 'string' ||
    legacyPath.length > MAX_PATH ||
    legacyPath.includes('\\') ||
    CONTROL_CHARS.test(legacyPath) ||
    legacyPath.split('/').some((part) => part === '..' || part === '.' || part === '');
  if (invalid) throw new Error('Caminho de arquivo inválido');
  return `contracts/${organizationId}/${legacyPath}`;
}

function keyFromUrl(organizationId: string, url: string | null): string | null {
  const path = legacyPathFromUrl(url);
  return path ? storageKeyFor(organizationId, path) : null;
}

export function mapLegacyContract(
  organizationId: string,
  row: LegacyContractRow,
): Prisma.ContractUncheckedCreateInput & { createdAt: Date; acceptedAt: Date | null } {
  validateContractRow(row);
  return {
    organizationId,
    legacyId: row.id,
    fullName: row.nome_completo,
    cpf: row.cpf,
    address: row.endereco ?? '',
    cep: row.cep ?? '',
    email: row.email ?? '',
    phone: row.telefone ?? '',
    requestedDates: row.datas_requeridas ?? '',
    guideName: row.nome_guia,
    sellerName: row.vendedor || null,
    days: row.quantidade_dias ?? 0,
    people: row.quantidade_pessoas ?? 1,
    amount: row.valor,
    pixKey: row.pix_key || null,
    disneyGuest: !!row.hospede_disney,
    purchased: !!row.comprado,
    paid: !!row.pago,
    invoiceIssued: !!row.nf_emitida,
    legacyChatUrl: row.umbler_chat_url || null,
    acceptanceToken: row.acceptance_token || null,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
    clientIp: row.client_ip || null,
    clientUserAgent: row.client_user_agent || null,
    signatureKey: keyFromUrl(organizationId, row.signature_url),
    signedContractKey: keyFromUrl(organizationId, row.signed_contract_url),
    paymentReceiptKey: keyFromUrl(organizationId, row.payment_receipt_url),
    createdAt: new Date(row.created_at),
  };
}

function isRealCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function mapLegacyBlockedDate(
  organizationId: string,
  row: LegacyBlockedDateRow,
): Prisma.ContractBlockedDateUncheckedCreateInput & { date: Date } {
  if (typeof row.guide_name !== 'string' || row.guide_name === '' || row.guide_name.length > MAX_TEXT) {
    throw new Error('Data bloqueada: guide_name deve ser texto não vazio');
  }
  if (!isRealCalendarDate(row.blocked_date)) {
    throw new Error('Data bloqueada inválida (blocked_date)');
  }
  if (!isValidDate(row.created_at)) {
    throw new Error('Data bloqueada: created_at não é data válida');
  }
  if (row.reason !== null && row.reason !== undefined) {
    if (typeof row.reason !== 'string' || row.reason.length > MAX_TEXT) {
      throw new Error('Data bloqueada: reason deve ser texto de até 2000 caracteres');
    }
  }
  return {
    organizationId,
    guideName: row.guide_name,
    date: new Date(`${row.blocked_date}T00:00:00.000Z`),
    reason: row.reason || 'lotado',
    createdAt: new Date(row.created_at),
  };
}
