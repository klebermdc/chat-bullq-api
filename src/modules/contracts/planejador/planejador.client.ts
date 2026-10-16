import { Injectable } from '@nestjs/common';
import type { ContractDate } from '../domain/park-dates';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY_CHARS = 200;
const PARK_TIME_START = '08:00';
const PARK_TIME_END = '22:00';

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

export function buildPlanejadorPayload(c: PlanejadorContractInput, dates: ContractDate[], password: string) {
  const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
  return {
    email: c.email,
    password,
    nome_completo: c.fullName,
    cpf: c.cpf,
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

type FetchFn = (
  url: string,
  init: any,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

@Injectable()
export class PlanejadorClient {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchFn: FetchFn = (u, i) => fetch(u, i) as any,
  ) {}

  /** O erro lançado tem só o status e o começo da resposta; nunca o payload enviado. */
  async createClient(payload: PlanejadorPayload): Promise<void> {
    const url = this.env.PLANEJADOR_CREATE_CLIENT_URL;
    if (!url) throw new Error('PLANEJADOR_CREATE_CLIENT_URL não configurada');
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.env.PLANEJADOR_API_KEY ?? ''}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
      throw new Error(`Planejador respondeu ${res.status}: ${body}`);
    }
  }
}
