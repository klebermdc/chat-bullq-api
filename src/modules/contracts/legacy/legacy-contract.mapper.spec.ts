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

  it.each(['a/./b', 'a\\b', 'a/b\u0000.png', 'a/b\n.png', 'a/\u007f', '', 'a//b'])(
    'recusa caminho suspeito %j',
    (p) => {
      expect(() => storageKeyFor('org1', p)).toThrow();
    },
  );

  it('recusa caminho com mais de 400 caracteres', () => {
    expect(() => storageKeyFor('org1', 'a'.repeat(401))).toThrow();
    expect(() => storageKeyFor('org1', 'a'.repeat(400))).not.toThrow();
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

describe('mapLegacyContract: validação de tipos', () => {
  const bad = (o: Record<string, unknown>) => () =>
    mapLegacyContract('org1', row(o as Partial<LegacyContractRow>));

  it.each(['id', 'nome_completo', 'cpf', 'nome_guia', 'valor', 'created_at'])(
    'obrigatório %s precisa ser string não vazia',
    (f) => {
      expect(bad({ [f]: 123 })).toThrow(new RegExp(f));
      expect(bad({ [f]: '' })).toThrow(new RegExp(f));
      expect(bad({ [f]: null })).toThrow(new RegExp(f));
    },
  );

  it('erro cita o id da linha', () => {
    expect(bad({ cpf: 5 })).toThrow(/77fc45d1/);
  });

  it('texto acima de 2000 caracteres é rejeitado; datas_requeridas e user agent aceitam 10000', () => {
    expect(bad({ endereco: 'x'.repeat(2001) })).toThrow(/endereco/);
    expect(bad({ email: 5 })).toThrow(/email/);
    expect(bad({ vendedor: {} })).toThrow(/vendedor/);
    expect(bad({ datas_requeridas: 'x'.repeat(10_000) })).not.toThrow();
    expect(bad({ datas_requeridas: 'x'.repeat(10_001) })).toThrow(/datas_requeridas/);
    expect(bad({ client_user_agent: 'x'.repeat(10_000) })).not.toThrow();
    expect(bad({ client_user_agent: 'x'.repeat(10_001) })).toThrow(/client_user_agent/);
  });

  it('quantidades: inteiro entre 0 e 10000 (pessoas pode ser null)', () => {
    expect(bad({ quantidade_dias: 1.5 })).toThrow(/quantidade_dias/);
    expect(bad({ quantidade_dias: -1 })).toThrow(/quantidade_dias/);
    expect(bad({ quantidade_dias: 10_001 })).toThrow(/quantidade_dias/);
    expect(bad({ quantidade_dias: '2' })).toThrow(/quantidade_dias/);
    expect(bad({ quantidade_pessoas: 2.5 })).toThrow(/quantidade_pessoas/);
    expect(bad({ quantidade_pessoas: null })).not.toThrow();
    expect(bad({ quantidade_dias: 0 })).not.toThrow();
    expect(bad({ quantidade_dias: 10_000 })).not.toThrow();
  });

  it('booleanos precisam ser boolean de verdade', () => {
    for (const f of ['hospede_disney', 'comprado', 'pago', 'nf_emitida']) {
      expect(bad({ [f]: 'false' })).toThrow(new RegExp(f));
      expect(bad({ [f]: 1 })).toThrow(new RegExp(f));
      expect(bad({ [f]: null })).toThrow(new RegExp(f));
    }
  });

  it('created_at e accepted_at precisam ser datas válidas', () => {
    expect(bad({ created_at: 'ontem' })).toThrow(/created_at/);
    expect(bad({ accepted_at: 'amanha' })).toThrow(/accepted_at/);
    expect(bad({ accepted_at: 5 })).toThrow(/accepted_at/);
    expect(bad({ accepted_at: null })).not.toThrow();
  });
});

describe('mapLegacyBlockedDate', () => {
  const blocked = (o: Record<string, unknown> = {}) => () =>
    mapLegacyBlockedDate('org1', {
      guide_name: 'Kleber',
      blocked_date: '2026-02-16',
      reason: 'lotado',
      created_at: '2026-02-14T02:29:14.375671+00:00',
      ...o,
    } as any);

  it('rejeita guia vazia ou não string', () => {
    expect(blocked({ guide_name: '' })).toThrow(/guide_name/);
    expect(blocked({ guide_name: 3 })).toThrow(/guide_name/);
  });

  it('rejeita data inexistente no calendário', () => {
    expect(blocked({ blocked_date: '2026-02-31' })).toThrow(/Data bloqueada/);
    expect(blocked({ blocked_date: '2026-02-28' })).not.toThrow();
  });

  it('rejeita created_at inválido e reason não string', () => {
    expect(blocked({ created_at: 'x' })).toThrow(/created_at/);
    expect(blocked({ reason: 5 })).toThrow(/reason/);
  });

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
