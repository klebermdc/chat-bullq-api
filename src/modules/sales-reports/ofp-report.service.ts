import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface OfpOrder {
  id: string;
  user_id: string | null;
  pedido: string | null;
  cliente: string | null;
  email_cliente: string | null;
  telefone_cliente: string | null;
  vendedor: string | null;
  venda: number | null;
  comissao: number | null;
  comissao_total: number | null;
  porcentagem_vendedor: number | null;
  comissao_vendedor: number | null;
  fornecedor: string | null;
  produto: string | null;
  data: string | null;
  status: string | null;
  enviado: boolean | null;
  guia: string | null;
  comissao_guia: number | null;
  created_at: string | null;
  updated_at: string | null;
  [k: string]: unknown;
}

export interface OfpProfile { id: string; email: string | null; full_name: string | null }
export interface OfpRole { user_id: string; role: string | null; salesperson_name: string | null }

export interface OrderFilters { vendedor?: string; month?: number; year?: number }

interface CacheEntry<T> { expires: number; value: T }

@Injectable()
export class OfpReportService {
  private readonly logger = new Logger(OfpReportService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs = 5 * 60 * 1000;

  constructor(private readonly config: ConfigService) {}

  private creds(): { key: string; baseUrl: string } {
    const key = this.config.get<string>('OFP_API_KEY');
    const baseUrl = this.config.get<string>('OFP_BASE_URL');
    if (!key) throw new InternalServerErrorException('OFP_API_KEY ausente na configuração');
    if (!baseUrl) throw new InternalServerErrorException('OFP_BASE_URL ausente na configuração');
    return { key, baseUrl };
  }

  private cached<T>(cacheKey: string): T | null {
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    return null;
  }

  private async fetchPage(
    table: string,
    params: Record<string, string | number | undefined>,
  ): Promise<{ rows: any[]; totalPages: number }> {
    const { key, baseUrl } = this.creds();
    const search = new URLSearchParams({ table });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
    }
    const url = `${baseUrl.replace(/\/$/, '')}?${search.toString()}`;
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        timeout: 20_000,
      });
      const rows: any[] = data.orders ?? data.profiles ?? data.roles ?? data.data ?? [];
      const totalPages: number = data.total_pages ?? 1;
      return { rows, totalPages };
    } catch (err: any) {
      if (err?.response?.status === 401) {
        throw new InternalServerErrorException('OFP: token inválido (OFP_API_KEY)');
      }
      this.logger.error(`OFP request failed: ${err?.message}`);
      throw new InternalServerErrorException('Falha ao consultar OFP Hub');
    }
  }

  private async fetchAll(
    table: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<any[]> {
    const perPage = 2000;
    let page = 1;
    let totalPages = 1;
    const all: any[] = [];
    do {
      const { rows, totalPages: tp } = await this.fetchPage(table, {
        ...params,
        page,
        per_page: perPage,
      });
      all.push(...rows);
      totalPages = tp;
      page += 1;
    } while (page <= totalPages);
    return all;
  }

  async getProfiles(): Promise<OfpProfile[]> {
    const c = this.cached<OfpProfile[]>('profiles');
    if (c) return c;
    const rows = (await this.fetchAll('profiles')) as OfpProfile[];
    this.cache.set('profiles', { expires: Date.now() + this.ttlMs, value: rows });
    return rows;
  }

  async getRoles(): Promise<OfpRole[]> {
    const c = this.cached<OfpRole[]>('roles');
    if (c) return c;
    const rows = (await this.fetchAll('user_roles')) as OfpRole[];
    this.cache.set('roles', { expires: Date.now() + this.ttlMs, value: rows });
    return rows;
  }

  async getOrders(filters: OrderFilters = {}): Promise<OfpOrder[]> {
    const hasFilter = !!(filters.vendedor || filters.month || filters.year);
    if (!hasFilter) {
      const c = this.cached<OfpOrder[]>('orders:all');
      if (c) return c;
      const rows = (await this.fetchAll('orders')) as OfpOrder[];
      this.cache.set('orders:all', { expires: Date.now() + this.ttlMs, value: rows });
      return rows;
    }
    return (await this.fetchAll('orders', {
      vendedor: filters.vendedor,
      month: filters.month,
      year: filters.year,
    })) as OfpOrder[];
  }
}
