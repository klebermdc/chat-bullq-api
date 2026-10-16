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
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const strict = attempt > 1 ? PARSER_STRICT_SUFFIX : '';
      const res = await this.llm.complete({
        organizationId,
        modelId: SAKANA_SIMPLE_MODEL,
        temperature: attempt === 1 ? 0 : 0.3,
        maxTokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `<<<TEXTO>>>\n${rawText}\n<<<FIM>>>${strict}\n\nExtraia o JSON:` },
        ],
      });
      const raw = this.extractText(res.message.content);
      try {
        return this.normalize(this.parseJson(raw));
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

  private normalize(o: Record<string, unknown>): ParsedContractText {
    const strings: Partial<Record<(typeof STRING_FIELDS)[number], string>> = {};
    for (const key of STRING_FIELDS) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) strings[key] = v.trim();
    }
    if (!strings.fullName) throw new Error('sem nome');
    const people = o.people;
    const rawDates = Array.isArray(o.parkDates) ? o.parkDates : [];
    const parkDates = rawDates.filter(
      (p): p is ParsedParkDate =>
        !!p && typeof p.parkId === 'string' && PARK_IDS.includes(p.parkId) &&
        typeof p.date === 'string' && ISO_DATE.test(p.date),
    ).map((p) => ({ parkId: p.parkId, date: p.date }));
    return {
      ...strings,
      fullName: strings.fullName,
      ...(typeof people === 'number' && Number.isInteger(people) && people > 0 ? { people } : {}),
      ...(typeof o.disneyGuest === 'boolean' ? { disneyGuest: o.disneyGuest } : {}),
      parkDates,
    };
  }
}
