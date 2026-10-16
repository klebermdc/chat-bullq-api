import { Injectable } from '@nestjs/common';
import type { ContractDate } from '../domain/park-dates';

const REQUEST_TIMEOUT_MS = 15_000;
const PARK_TIME_START = '08:00';
const PARK_TIME_END = '22:00';
const CPF_DIGITS = 11;

export interface PlanejadorContractInput {
  id: string;
  fullName: string;
  cpf: string;
  phone: string;
  address: string;
  cep: string;
  email: string;
  guideName: string;
  amount: string;
  people: number;
  disneyGuest: boolean;
}

/** Variável de ambiente ausente ou inválida: a mensagem é nossa, sem dado do cliente. */
export class PlanejadorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanejadorConfigError';
  }
}

/** Resposta não-2xx. Só o status: o corpo pode ecoar e-mail/CPF e nunca sai do client. */
export class PlanejadorHttpError extends Error {
  constructor(readonly status: number) {
    super(`Planejador respondeu ${status}`);
    this.name = 'PlanejadorHttpError';
  }
}

/** `XXX.XXX.XXX-XX` quando há 11 dígitos; senão devolve como veio. */
export function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== CPF_DIGITS) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function buildPlanejadorPayload(c: PlanejadorContractInput, dates: ContractDate[], password: string) {
  const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  return {
    email: c.email,
    password,
    nome_completo: c.fullName,
    cpf: formatCpf(c.cpf),
    telefone: c.phone,
    endereco: c.address,
    cep: c.cep,
    contract_id: c.id,
    nome_guia: c.guideName,
    valor: c.amount,
    quantidade_pessoas: String(c.people),
    quantidade_dias: sorted.length,
    hospede_disney: c.disneyGuest,
    start_date: sorted[0]?.date ?? null,
    end_date: sorted[sorted.length - 1]?.date ?? null,
    parks: sorted.map((d) => ({
      date: d.date,
      park: d.label,
      time_start: PARK_TIME_START,
      time_end: PARK_TIME_END,
      ...(c.disneyGuest ? { notes: 'Hóspede Disney' } : {}),
    })),
  };
}

export type PlanejadorPayload = ReturnType<typeof buildPlanejadorPayload>;

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

function requireHttpsUrl(raw: string | undefined): string {
  if (!raw) throw new PlanejadorConfigError('PLANEJADOR_CREATE_CLIENT_URL não configurada');
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    throw new PlanejadorConfigError('PLANEJADOR_CREATE_CLIENT_URL inválida');
  }
  if (protocol !== 'https:') throw new PlanejadorConfigError('PLANEJADOR_CREATE_CLIENT_URL precisa ser https');
  return raw;
}

function requireApiKey(raw: string | undefined): string {
  const key = raw?.trim();
  if (!key) throw new PlanejadorConfigError('PLANEJADOR_API_KEY não configurada');
  return key;
}

@Injectable()
export class PlanejadorClient {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchFn: FetchLike = (u, i) => fetch(u, i),
  ) {}

  /**
   * Lança PlanejadorConfigError (env), PlanejadorHttpError (só o status) ou o
   * erro de rede/timeout do fetch. Nunca inclui o payload nem o corpo da resposta.
   */
  async createClient(payload: PlanejadorPayload): Promise<void> {
    const url = requireHttpsUrl(this.env.PLANEJADOR_CREATE_CLIENT_URL);
    const apiKey = requireApiKey(this.env.PLANEJADOR_API_KEY);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    const res = await this.fetchFn(url, init);
    if (!res.ok) throw new PlanejadorHttpError(res.status);
  }
}
