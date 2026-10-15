import type { Prisma } from '@prisma/client';
import {
  LEGACY_BUCKET_MARKER,
  type LegacyBlockedDateRow,
  type LegacyContractRow,
} from './legacy.types';

const REQUIRED_FIELDS: (keyof LegacyContractRow)[] = [
  'id',
  'nome_completo',
  'cpf',
  'nome_guia',
  'valor',
  'created_at',
];

/** Caminho do arquivo dentro do bucket `contract-documents`, decodificado. */
export function legacyPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const at = url.indexOf(LEGACY_BUCKET_MARKER);
  if (at < 0) return null;
  const raw = url.slice(at + LEGACY_BUCKET_MARKER.length).split('?')[0];
  return raw ? decodeURIComponent(raw) : null;
}

export function storageKeyFor(organizationId: string, legacyPath: string): string {
  if (legacyPath.split('/').some((part) => part === '..' || part === '')) {
    throw new Error(`Caminho de arquivo inválido: ${legacyPath}`);
  }
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
  const missing = REQUIRED_FIELDS.filter((f) => row[f] === null || row[f] === undefined || row[f] === '');
  if (missing.length) {
    throw new Error(`Contrato ${row.id ?? '(sem id)'} sem ${missing.join(', ')}`);
  }
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

export function mapLegacyBlockedDate(
  organizationId: string,
  row: LegacyBlockedDateRow,
): Prisma.ContractBlockedDateUncheckedCreateInput & { date: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.blocked_date)) {
    throw new Error(`Data bloqueada inválida: ${row.blocked_date}`);
  }
  return {
    organizationId,
    guideName: row.guide_name,
    date: new Date(`${row.blocked_date}T00:00:00.000Z`),
    reason: row.reason || 'lotado',
    createdAt: new Date(row.created_at),
  };
}
