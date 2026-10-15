import {
  legacyPathFromUrl,
  storageKeyFor,
  mapLegacyContract,
  mapLegacyBlockedDate,
} from './legacy-contract.mapper';
import type { LegacyContractRow } from './legacy.types';

const BASE =
  'https://rdgxxwdpdsqojjquftan.supabase.co/storage/v1/object/public/contract-documents/';

function row(overrides: Partial<LegacyContractRow> = {}): LegacyContractRow {
  return {
    id: '77fc45d1-be09-4769-85f0-01c18e4a19fe',
    nome_completo: 'Cliente Teste',
    cpf: '000.000.000-00',
    endereco: 'Rua A, 1',
    cep: '00000-000',
    email: 'cliente@example.com',
    telefone: '(11) 90000-0000',
    datas_requeridas: 'Datas a definir',
    nome_guia: 'Kleber',
    vendedor: 'Marcella',
    quantidade_dias: 2,
    quantidade_pessoas: 4,
    valor: '2190,00',
    pix_key: '55513365000101',
    hospede_disney: false,
    comprado: true,
    pago: true,
    nf_emitida: false,
    umbler_chat_url: null,
    acceptance_token: '934d56314e0144f98b5788ba',
    accepted_at: '2026-10-15T19:30:00+00:00',
    client_ip: '1.2.3.4',
    client_user_agent: 'Mozilla',
    signature_url: `${BASE}signatures/abc.png`,
    signed_contract_url: null,
    payment_receipt_url: `${BASE}receipts/x_1_Comprovante%20Fast.jpeg`,
    created_at: '2026-10-15T19:01:28.127626+00:00',
    ...overrides,
  };
}

describe('legacyPathFromUrl', () => {
  it('extrai o caminho do bucket e decodifica %20', () => {
    expect(legacyPathFromUrl(`${BASE}receipts/a_1_Compr%20orlando.png`)).toBe(
      'receipts/a_1_Compr orlando.png',
    );
  });

  it('ignora query string', () => {
    expect(legacyPathFromUrl(`${BASE}signatures/a.png?t=1`)).toBe('signatures/a.png');
  });

  it('devolve null para vazio e para URL de fora do bucket', () => {
    expect(legacyPathFromUrl(null)).toBeNull();
    expect(legacyPathFromUrl('https://example.com/x.png')).toBeNull();
  });
});

describe('storageKeyFor', () => {
  it('prefixa com contracts/<org>/', () => {
    expect(storageKeyFor('org1', 'signatures/a.png')).toBe('contracts/org1/signatures/a.png');
  });

  it('recusa caminho com ..', () => {
    expect(() => storageKeyFor('org1', '../x')).toThrow();
  });
});

describe('mapLegacyContract', () => {
  it('mapeia todos os campos e preserva datas e token', () => {
    const out = mapLegacyContract('org1', row());

    expect(out).toMatchObject({
      organizationId: 'org1',
      legacyId: '77fc45d1-be09-4769-85f0-01c18e4a19fe',
      fullName: 'Cliente Teste',
      guideName: 'Kleber',
      sellerName: 'Marcella',
      days: 2,
      people: 4,
      amount: '2190,00',
      purchased: true,
      paid: true,
      invoiceIssued: false,
      acceptanceToken: '934d56314e0144f98b5788ba',
      signatureKey: 'contracts/org1/signatures/abc.png',
      signedContractKey: null,
      paymentReceiptKey: 'contracts/org1/receipts/x_1_Comprovante Fast.jpeg',
    });
    expect(out.createdAt.toISOString()).toBe('2026-10-15T19:01:28.127Z');
    expect(out.acceptedAt?.toISOString()).toBe('2026-10-15T19:30:00.000Z');
  });

  it('pessoas nulo vira 1', () => {
    expect(mapLegacyContract('org1', row({ quantidade_pessoas: null })).people).toBe(1);
  });

  it('falha com mensagem clara quando falta campo obrigatório', () => {
    expect(() => mapLegacyContract('org1', row({ nome_completo: '' }))).toThrow(
      /77fc45d1.*nome_completo/,
    );
  });
});

describe('mapLegacyBlockedDate', () => {
  it('converte a data para meia-noite UTC', () => {
    const out = mapLegacyBlockedDate('org1', {
      guide_name: 'Kleber',
      blocked_date: '2026-02-16',
      reason: 'lotado',
      created_at: '2026-02-14T02:29:14.375671+00:00',
    });
    expect(out.date.toISOString()).toBe('2026-02-16T00:00:00.000Z');
    expect(out.guideName).toBe('Kleber');
  });
});
