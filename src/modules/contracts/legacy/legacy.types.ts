/** Linha de `public.contracts` no Supabase do Lovable, como veio no backup. */
export interface LegacyContractRow {
  id: string;
  nome_completo: string;
  cpf: string;
  endereco: string;
  cep: string;
  email: string;
  telefone: string;
  datas_requeridas: string;
  nome_guia: string;
  vendedor: string | null;
  quantidade_dias: number;
  quantidade_pessoas: number | null;
  valor: string;
  pix_key: string | null;
  hospede_disney: boolean;
  comprado: boolean;
  pago: boolean;
  nf_emitida: boolean;
  umbler_chat_url: string | null;
  acceptance_token: string | null;
  accepted_at: string | null;
  client_ip: string | null;
  client_user_agent: string | null;
  signature_url: string | null;
  signed_contract_url: string | null;
  payment_receipt_url: string | null;
  created_at: string;
}

/** Linha de `public.blocked_dates`. */
export interface LegacyBlockedDateRow {
  guide_name: string;
  blocked_date: string; // "YYYY-MM-DD"
  reason: string;
  created_at: string;
}

export const LEGACY_BUCKET_MARKER = '/contract-documents/';
