import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SAKANA_SIMPLE_MODEL } from '../../ai-agents/llm/llm.constants';
import { LlmService } from '../../ai-agents/llm/llm.service';
import { LlmContent } from '../../ai-agents/llm/llm.types';
import { PARK_IDS } from '../contracts.constants';
import { buildParserSystemPrompt, PARSER_STRICT_SUFFIX } from './contract-parser.prompts';

const MAX_ATTEMPTS = 3;
// Modelo "reasoning": escreve <think>...</think> antes do JSON; precisa de folga.
const MAX_TOKENS = 4000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRING_FIELDS = ['fullName', 'email', 'cpf', 'phone', 'cep', 'address', 'guideName'] as const;
type StringField = (typeof STRING_FIELDS)[number];
const NUMERIC_AS_STRING_FIELDS: readonly StringField[] = ['cpf', 'phone', 'cep'];
const DEFAULT_MAX_LENGTH = 255;
const MAX_LENGTH: Partial<Record<StringField, number>> = { fullName: 100, address: 300 };
const MIN_PEOPLE = 1;
const MAX_PEOPLE = 500;
const TRUE_WORDS = ['sim', 'true'];
const FALSE_WORDS = ['não', 'nao', 'false'];
const DELIMITER_TOKENS = /<<<(?:TEXTO|FIM)>>>/g;

function stripDelimiters(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(DELIMITER_TOKENS, '');
    if (next === current) return next;
    current = next;
  }
}

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return isRealDate(y, m, d);
}

function coerceString(key: StringField, v: unknown): string | undefined {
  const asString = typeof v === 'string' ? v : NUMERIC_AS_STRING_FIELDS.includes(key) && typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;
  const trimmed = asString?.trim();
  return trimmed ? trimmed.slice(0, MAX_LENGTH[key] ?? DEFAULT_MAX_LENGTH) : undefined;
}

function coercePeople(v: unknown): number | undefined {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_PEOPLE && n <= MAX_PEOPLE ? n : undefined;
}

function coerceBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const w = v.trim().toLowerCase();
  if (TRUE_WORDS.includes(w)) return true;
  if (FALSE_WORDS.includes(w)) return false;
  return undefined;
}

export interface ParsedParkDate {
  parkId: string;
  date: string;
}

export interface ParsedContractText {
  fullName: string;
  email?: string;
  cpf?: string;
  phone?: string;
  cep?: string;
  address?: string;
  people?: number;
  disneyGuest?: boolean;
  guideName?: string;
  parkDates: ParsedParkDate[];
}

@Injectable()
export class ContractParserService {
  private readonly logger = new Logger(ContractParserService.name);

  constructor(private readonly llm: LlmService) {}

  async parse(organizationId: string, rawText: string, today: Date = new Date()): Promise<ParsedContractText> {
    const system = buildParserSystemPrompt(today);
    const safeText = stripDelimiters(rawText);
    const todayIso = today.toISOString().slice(0, 10);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const strict = attempt > 1 ? PARSER_STRICT_SUFFIX : '';
      const res = await this.llm.complete({
        organizationId,
        modelId: SAKANA_SIMPLE_MODEL,
        temperature: attempt === 1 ? 0 : 0.3,
        maxTokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `<<<TEXTO>>>\n${safeText}\n<<<FIM>>>${strict}\n\nExtraia o JSON:` },
        ],
      });
      const raw = this.extractText(res.message.content);
      try {
        return this.normalize(this.parseJson(raw), todayIso);
      } catch (err) {
        // Não loga o texto bruto: pode conter CPF/telefone do cliente.
        this.logger.warn(`contract_parse_attempt_${attempt}_failed: ${(err as Error).message}`);
      }
    }
    throw new BadRequestException('Não consegui ler os dados do texto. Confira o conteúdo colado ou preencha à mão.');
  }

  private extractText(content: LlmContent): string {
    if (typeof content === 'string') return content;
    return content
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text: string }).text)
      .join('');
  }

  private parseJson(raw: string): Record<string, unknown> {
    const cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
      .replace(/<think>[\s\S]*$/i, ' ')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end < start) throw new Error('resposta não é JSON');
    const slice = cleaned.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
    try {
      const parsed: unknown = JSON.parse(slice);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('não é objeto');
      return parsed as Record<string, unknown>;
    } catch {
      throw new Error('JSON inválido');
    }
  }

  private normalize(o: Record<string, unknown>, todayIso: string): ParsedContractText {
    const strings: Partial<Record<StringField, string>> = {};
    for (const key of STRING_FIELDS) {
      const v = coerceString(key, o[key]);
      if (v) strings[key] = v;
    }
    if (!strings.fullName) throw new Error('sem nome');
    const people = coercePeople(o.people);
    const disneyGuest = coerceBoolean(o.disneyGuest);
    return {
      ...strings,
      fullName: strings.fullName,
      ...(people !== undefined ? { people } : {}),
      ...(disneyGuest !== undefined ? { disneyGuest } : {}),
      parkDates: this.normalizeParkDates(o.parkDates, todayIso),
    };
  }

  private normalizeParkDates(raw: unknown, todayIso: string): ParsedParkDate[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: ParsedParkDate[] = [];
    for (const p of raw) {
      if (!p || typeof p.parkId !== 'string' || !PARK_IDS.includes(p.parkId)) continue;
      if (typeof p.date !== 'string' || !isRealIsoDate(p.date) || p.date < todayIso) continue;
      const key = `${p.parkId}|${p.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ parkId: p.parkId, date: p.date });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }
}
