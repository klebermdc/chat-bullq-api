# Copiloto — Chat Interno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma aba "Copiloto" no OFP Chat web onde OWNER/ADMIN conversam em linguagem natural com o agente interno "Copiloto" (já em prod), que consulta vendas/clientes/funil via as 7 skills já criadas — sem WhatsApp/canal/bot.

**Architecture:** Backend: módulo `copilot` com endpoint síncrono `POST /copilot/ask` que roda um loop de tool-calling reusando `LlmService` (modelo + tool-calling), os executores de skill (`HttpToolExecutorService`/`SqlToolExecutorService`) e `sanitizeAssistantText`. Frontend: página `/copiloto` + item de menu gated por papel (OWNER/ADMIN) chamando o endpoint. Sem migração (v1 stateless — o front manda o histórico).

**Tech Stack:** NestJS 11 + Prisma 6 (jest/ts-jest para testes) no backend; Next.js (App Router) + Tailwind + axios + zustand no frontend. Spec: `docs/superpowers/specs/2026-07-14-copiloto-chat-interno-design.md`.

---

## File Structure

**Backend (`chat-bullq-api/`)**
- Create `src/modules/copilot/dto/ask.dto.ts` — validação do body `{ text, history? }`.
- Create `src/modules/copilot/copilot.service.ts` — resolve o agente, monta tools, roda o loop de tool-calling, sanitiza e retorna `{ reply }`.
- Create `src/modules/copilot/copilot.service.spec.ts` — testes do service (mocks).
- Create `src/modules/copilot/copilot.controller.ts` — `POST /copilot/ask`, guards + `@Roles(OWNER, ADMIN)`.
- Create `src/modules/copilot/copilot.controller.spec.ts` — teste do metadata de RBAC.
- Create `src/modules/copilot/copilot.module.ts` — importa `LlmModule` + `ToolsModule`.
- Modify `src/app.module.ts` — registra `CopilotModule`.

**Frontend (`chat-bullq-web/`)**
- Create `src/features/copilot/api.ts` — `askCopilot(text, history)`.
- Create `src/features/copilot/components/copilot-chat.tsx` — o chat (lista, chips, composer).
- Create `src/app/(dashboard)/copiloto/page.tsx` — a rota `/copiloto`.
- Modify `src/components/layout/app-sidebar.tsx` — item "Copiloto" gated por papel (menu cheio + rail).

> **Nota de testes:** o backend usa TDD com jest. O `chat-bullq-web` **não tem harness de testes** (nenhum `*.test`/`*.spec`, sem script `test`) — não vamos introduzir um framework (respeita o padrão do repo). O frontend é verificado por **typecheck/build + E2E manual** (Task 8).

---

## Task 1: DTO do endpoint

**Files:**
- Create: `src/modules/copilot/dto/ask.dto.ts`

- [ ] **Step 1: Escrever o DTO**

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CopilotTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class AskDto {
  @ApiProperty({ example: 'quantas vendas o Pedro fez em julho?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({
    type: [CopilotTurnDto],
    description: 'Histórico recente da sessão (o front envia; backend não persiste).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotTurnDto)
  history?: CopilotTurnDto[];
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd chat-bullq-api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep copilot || echo "sem erros em copilot"`
Expected: `sem erros em copilot`

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-api && git add src/modules/copilot/dto/ask.dto.ts
git commit -m "feat(copilot): DTO do endpoint /copilot/ask"
```

---

## Task 2: CopilotService — resolver o agente (TDD)

**Files:**
- Create: `src/modules/copilot/copilot.service.spec.ts`
- Create: `src/modules/copilot/copilot.service.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { BadRequestException } from '@nestjs/common';
import { CopilotService } from './copilot.service';

function makeService(overrides: Partial<any> = {}) {
  const prisma = {
    aiAgent: { findFirst: jest.fn() },
    aiAgentSkill: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const llm = { complete: jest.fn() };
  const http = { execute: jest.fn() };
  const sql = { execute: jest.fn() };
  Object.assign(prisma, overrides.prisma ?? {});
  const service = new CopilotService(prisma as any, llm as any, http as any, sql as any);
  return { service, prisma, llm, http, sql };
}

describe('CopilotService', () => {
  it('lança BadRequest quando não há agente copiloto configurado', async () => {
    const { service, prisma } = makeService();
    prisma.aiAgent.findFirst.mockResolvedValue(null);
    await expect(service.ask('org1', 'oi')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-bullq-api && npx jest src/modules/copilot/copilot.service.spec.ts`
Expected: FAIL — `Cannot find module './copilot.service'`.

- [ ] **Step 3: Implementação mínima do service (resolver agente)**

```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AiSkill, AiTool } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../ai-agents/llm/llm.service';
import { HttpToolExecutorService } from '../ai-agents/tools/http-tool-executor.service';
import { SqlToolExecutorService } from '../ai-agents/tools/sql-tool-executor.service';
import { sanitizeAssistantText } from '../ai-agents/runner/text-guards';
import type {
  LlmContent,
  LlmMessage,
  LlmTextPart,
  LlmToolDefinition,
} from '../ai-agents/llm/llm.types';
import type { ToolContext } from '../ai-agents/tools/tool.types';

export type CopilotTurn = { role: 'user' | 'assistant'; content: string };

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  private static readonly MAX_ITERATIONS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly httpExec: HttpToolExecutorService,
    private readonly sqlExec: SqlToolExecutorService,
  ) {}

  async ask(
    organizationId: string,
    text: string,
    history: CopilotTurn[] = [],
  ): Promise<{ reply: string }> {
    const agent = await this.prisma.aiAgent.findFirst({
      where: {
        organizationId,
        category: 'copiloto-interno',
        isActive: true,
        deletedAt: null,
      },
    });
    if (!agent) {
      throw new BadRequestException(
        'O Copiloto ainda não está configurado nesta conta.',
      );
    }
    return { reply: '' }; // completado na Task 3
  }

  private textOf(content: LlmContent): string {
    if (typeof content === 'string') return content;
    return content
      .filter((p): p is LlmTextPart => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/copilot/copilot.service.spec.ts`
Expected: PASS (1 teste).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api && git add src/modules/copilot/copilot.service.ts src/modules/copilot/copilot.service.spec.ts
git commit -m "feat(copilot): service resolve agente copiloto-interno (TDD)"
```

---

## Task 3: CopilotService — loop de tool-calling (TDD)

**Files:**
- Modify: `src/modules/copilot/copilot.service.spec.ts`
- Modify: `src/modules/copilot/copilot.service.ts`

- [ ] **Step 1: Escrever o teste do loop (uma tool call SQL → resposta final)**

Adicionar dentro do `describe('CopilotService', ...)`:

```ts
  it('executa uma skill SQL e devolve a resposta final sanitizada', async () => {
    const { service, prisma, llm, sql } = makeService();
    prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent1',
      modelId: 'sakana/fugu',
      systemPrompt: 'Você é o Copiloto.',
      temperature: 0.4,
      maxTokens: 2048,
      category: 'copiloto-interno',
      isActive: true,
    });
    prisma.aiAgentSkill.findMany.mockResolvedValue([
      {
        skill: {
          name: 'buscarClientePorTelefone',
          description: 'Busca cliente por telefone.',
          parameters: { type: 'object', properties: {} },
          source: 'SQL',
          isActive: true,
          deletedAt: null,
          promptInstructions: null,
          tool: { id: 't1', source: 'CUSTOM_SQL' },
        },
      },
    ]);
    // 1ª chamada: modelo pede a tool. 2ª chamada: modelo responde texto final.
    llm.complete
      .mockResolvedValueOnce({
        stopReason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 'buscarClientePorTelefone', arguments: { telefone: '41999' } },
          ],
        },
        usage: {},
      })
      .mockResolvedValueOnce({
        stopReason: 'stop',
        message: { role: 'assistant', content: '<think>hmm</think>É a Ana Souza.' },
        usage: {},
      });
    sql.execute.mockResolvedValue({ output: { ok: true, rows: [{ cliente: 'Ana Souza' }] } });

    const res = await service.ask('org1', 'quem é o 41999?');

    expect(sql.execute).toHaveBeenCalledTimes(1);
    // ToolContext escopado no tenant certo:
    const ctxArg = sql.execute.mock.calls[0][3];
    expect(ctxArg.organizationId).toBe('org1');
    // <think> removido:
    expect(res.reply).toBe('É a Ana Souza.');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-bullq-api && npx jest src/modules/copilot/copilot.service.spec.ts`
Expected: FAIL — `res.reply` é `''` (loop ainda não implementado).

- [ ] **Step 3: Implementar o loop (substituir o `return { reply: '' }` da Task 2)**

Substituir a linha `return { reply: '' }; // completado na Task 3` por:

```ts
    // Skills do agente → tool defs + mapa de dispatch (só custom HTTP/SQL).
    const skillLinks = await this.prisma.aiAgentSkill.findMany({
      where: { agentId: agent.id },
      include: { skill: { include: { tool: true } } },
    });
    const skillsByName = new Map<string, AiSkill & { tool: AiTool | null }>();
    const tools: LlmToolDefinition[] = [];
    const skillInstructions: string[] = [];
    for (const link of skillLinks) {
      const skill = link.skill as AiSkill & { tool: AiTool | null };
      if (!skill.isActive || skill.deletedAt || !skill.tool) continue;
      if (skill.source === 'BUILTIN') continue;
      skillsByName.set(skill.name, skill);
      tools.push({
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters as Record<string, unknown>,
      });
      if (skill.promptInstructions) {
        skillInstructions.push(skill.promptInstructions.trim());
      }
    }

    const systemPrompt = [agent.systemPrompt, ...skillInstructions]
      .filter(Boolean)
      .join('\n\n');
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).map(
        (t): LlmMessage => ({ role: t.role, content: t.content }),
      ),
      { role: 'user', content: text },
    ];

    // Não há conversa real: preenchemos organizationId/agentId reais e
    // sentinelas nos campos que as skills atuais não leem.
    const ctx: ToolContext = {
      organizationId,
      agentId: agent.id,
      conversationId: 'copilot',
      contactId: 'copilot',
      channelId: 'copilot',
      runId: 'copilot',
    };

    for (let i = 0; i < CopilotService.MAX_ITERATIONS; i++) {
      const res = await this.llm.complete({
        organizationId,
        modelId: agent.modelId,
        messages,
        tools: tools.length ? tools : undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      });
      messages.push(res.message);

      if (res.stopReason !== 'tool_calls' || !res.message.toolCalls?.length) {
        const reply = sanitizeAssistantText(this.textOf(res.message.content));
        return { reply: reply || 'Não consegui gerar uma resposta agora.' };
      }

      for (const call of res.message.toolCalls) {
        const skill = skillsByName.get(call.name);
        let output: unknown;
        if (!skill || !skill.tool) {
          output = { ok: false, error: `Skill desconhecida: ${call.name}` };
        } else {
          try {
            const result =
              skill.source === 'SQL'
                ? await this.sqlExec.execute(skill, skill.tool, call.arguments, ctx)
                : await this.httpExec.execute(skill, skill.tool, call.arguments, ctx);
            output = result.output;
          } catch (err: any) {
            output = { ok: false, error: err?.message ?? String(err) };
          }
        }
        messages.push({
          role: 'tool',
          content: JSON.stringify(output),
          toolCallId: call.id,
          name: call.name,
        });
      }
    }

    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    return {
      reply: last
        ? sanitizeAssistantText(this.textOf(last.content)) ||
          'Não consegui concluir a consulta.'
        : 'Não consegui concluir a consulta.',
    };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/copilot/copilot.service.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api && git add src/modules/copilot/copilot.service.ts src/modules/copilot/copilot.service.spec.ts
git commit -m "feat(copilot): loop de tool-calling reusando LlmService + executores (TDD)"
```

---

## Task 4: Controller + RBAC (TDD do metadata)

**Files:**
- Create: `src/modules/copilot/copilot.controller.ts`
- Create: `src/modules/copilot/copilot.controller.spec.ts`

- [ ] **Step 1: Escrever o teste de RBAC (metadata `@Roles`)**

```ts
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CopilotController } from './copilot.controller';

describe('CopilotController', () => {
  it('restringe /copilot/ask a OWNER e ADMIN', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, CopilotController.prototype.ask);
    expect(roles).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
  });

  it('delega ao service com orgId, text e history', async () => {
    const copilot = { ask: jest.fn().mockResolvedValue({ reply: 'ok' }) };
    const controller = new CopilotController(copilot as any);
    const dto = { text: 'oi', history: [{ role: 'user' as const, content: 'a' }] };
    const out = await controller.ask('org1', dto as any);
    expect(copilot.ask).toHaveBeenCalledWith('org1', 'oi', dto.history);
    expect(out).toEqual({ reply: 'ok' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-bullq-api && npx jest src/modules/copilot/copilot.controller.spec.ts`
Expected: FAIL — `Cannot find module './copilot.controller'`.

- [ ] **Step 3: Implementar o controller**

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CopilotService } from './copilot.service';
import { AskDto } from './dto/ask.dto';
import { CurrentOrg, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';

@ApiTags('Copilot (interno)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Post('ask')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Pergunta ao Copiloto interno (só OWNER/ADMIN)' })
  ask(@CurrentOrg('id') orgId: string, @Body() dto: AskDto) {
    return this.copilot.ask(orgId, dto.text, dto.history ?? []);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/copilot/copilot.controller.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api && git add src/modules/copilot/copilot.controller.ts src/modules/copilot/copilot.controller.spec.ts
git commit -m "feat(copilot): controller POST /copilot/ask com RBAC OWNER/ADMIN (TDD)"
```

---

## Task 5: Módulo + registro no app

**Files:**
- Create: `src/modules/copilot/copilot.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Criar o módulo**

```ts
import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { ToolsModule } from '../ai-agents/tools/tools.module';

@Module({
  imports: [LlmModule, ToolsModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
```

- [ ] **Step 2: Registrar no `app.module.ts`**

Adicionar o import no topo (junto dos outros módulos):

```ts
import { CopilotModule } from './modules/copilot/copilot.module';
```

E adicionar `CopilotModule,` na lista `imports` do `@Module` (ex.: logo após `CrmReportsModule,`).

- [ ] **Step 3: Buildar o projeto inteiro (garante DI + imports resolvidos)**

Run: `cd chat-bullq-api && npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

- [ ] **Step 4: Rodar toda a suíte do copilot**

Run: `cd chat-bullq-api && npx jest src/modules/copilot`
Expected: PASS (4 testes no total).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api && git add src/modules/copilot/copilot.module.ts src/app.module.ts
git commit -m "feat(copilot): registra CopilotModule no app"
```

---

## Task 6: Frontend — cliente de API + componente de chat

**Files:**
- Create: `chat-bullq-web/src/features/copilot/api.ts`
- Create: `chat-bullq-web/src/features/copilot/components/copilot-chat.tsx`

- [ ] **Step 1: Cliente de API**

```ts
import { api } from '@/lib/api';

export type CopilotTurn = { role: 'user' | 'assistant'; content: string };

export async function askCopilot(
  text: string,
  history: CopilotTurn[],
): Promise<string> {
  const { data } = await api.post('/copilot/ask', { text, history });
  // A API embrulha respostas em { data, meta }.
  const payload = (data?.data ?? data) as { reply: string };
  return payload.reply;
}
```

- [ ] **Step 2: Componente de chat**

```tsx
'use client';

import { useRef, useState } from 'react';
import { Sparkles, Send, Lock } from 'lucide-react';
import { askCopilot, type CopilotTurn } from '@/features/copilot/api';

const SUGGESTIONS = [
  'Quantas vendas o Pedro fez em julho?',
  'Como está o funil Vendas OFP?',
  'Ranking de vendas do mês',
];

export function CopilotChat() {
  const [turns, setTurns] = useState<CopilotTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    setInput('');
    const history = turns.slice(-10);
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setLoading(true);
    try {
      const reply = await askCopilot(q, history);
      setTurns((t) => [...t, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ??
        'Não consegui consultar agora. Tenta de novo.';
      setError(typeof msg === 'string' ? msg : 'Erro ao consultar.');
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: 'smooth' }),
      );
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      <header className="flex items-center gap-2 px-4 py-4">
        <Sparkles className="size-5 text-violet-600 dark:text-violet-300" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Copiloto
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Assistente interno de vendas, clientes e funil
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-300">
          <Lock className="size-3" /> Só Proprietário e Admin
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-2">
        {turns.length === 0 && (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            Oi! 👋 Pergunta sobre <b>vendas</b>, <b>clientes</b> ou o <b>funil</b>.
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                t.role === 'user'
                  ? 'bg-violet-600 text-white'
                  : 'border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
              }`}
            >
              {t.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
              digitando…
            </div>
          </div>
        )}
        {error && <div className="text-sm text-red-500">{error}</div>}
        <div ref={endRef} />
      </div>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-violet-700 transition-colors hover:bg-violet-50 dark:border-zinc-700 dark:text-violet-300 dark:hover:bg-violet-400/10"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 px-4 py-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte ao Copiloto…"
          className="flex-1 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Enviar"
          className="grid size-11 place-items-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: sem erros novos em `features/copilot`.

- [ ] **Step 4: Commit**

```bash
cd chat-bullq-web && git add src/features/copilot
git commit -m "feat(copilot): cliente de API + componente de chat"
```

---

## Task 7: Frontend — rota `/copiloto` + item de menu (gated por papel)

**Files:**
- Create: `chat-bullq-web/src/app/(dashboard)/copiloto/page.tsx`
- Modify: `chat-bullq-web/src/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Criar a página**

```tsx
'use client';

import { CopilotChat } from '@/features/copilot/components/copilot-chat';

export default function CopilotoPage() {
  return (
    <div className="h-full min-h-0">
      <CopilotChat />
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o ícone `Sparkles` ao import de `lucide-react` em `app-sidebar.tsx`**

No bloco de import de `lucide-react`, adicionar `Sparkles,` à lista (ex.: depois de `Bot,`).

- [ ] **Step 3: Adicionar o item ao `navItems` (com flag `adminOnly`)**

Trocar a const `navItems` por:

```ts
const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false },
  { href: '/copiloto', label: 'Copiloto', icon: Sparkles, adminOnly: true },
  { href: '/inactivity', label: 'Inatividade', icon: Clock, adminOnly: false },
  { href: '/projects', label: 'Projetos', icon: FolderKanban, adminOnly: false },
  { href: '/automations', label: 'Automações', icon: Zap, adminOnly: false },
  { href: '/relatorios-vendas', label: 'Relatórios de Vendas', icon: BarChart3, adminOnly: false },
  { href: '/relatorios', label: 'Relatórios', icon: FileBarChart, adminOnly: false },
];
```

- [ ] **Step 4: Adicionar um helper de papel e filtrar (menu cheio)**

No corpo do componente `AppSidebar`, logo após `const activeOrg = ...`, adicionar:

```ts
  const role = organizations.find((o) => o.id === activeOrgId)?.role;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const visibleNav = navItems.filter((i) => !i.adminOnly || isAdmin);
```

E no `SidebarBody`, trocar `{navItems.map(...)}` por `{visibleNav.map(...)}`.

- [ ] **Step 5: Filtrar também no rail recolhido (`AppSidebarRail`)**

Em `AppSidebarRail`, `railItems` inclui `...navItems`. Logo após `const activeOrg = ...` no `AppSidebarRail`, adicionar:

```ts
  const role = organizations.find((o) => o.id === activeOrgId)?.role;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const visibleRail = railItems.filter((i) => !('adminOnly' in i) || !i.adminOnly || isAdmin);
```

E trocar `{railItems.map(...)}` por `{visibleRail.map(...)}`.

> Nota: `railItems` mistura itens sem `adminOnly` (Inbox/Pipelines/Jarvis) e os de `navItems`. O filtro `!('adminOnly' in i) || !i.adminOnly || isAdmin` mantém os sem a flag e esconde o Copiloto para AGENT.

- [ ] **Step 6: Typecheck + build**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
cd chat-bullq-web && git add "src/app/(dashboard)/copiloto/page.tsx" src/components/layout/app-sidebar.tsx
git commit -m "feat(copilot): rota /copiloto + item de menu gated por papel"
```

---

## Task 8: Verificação E2E manual (sem harness de teste no web)

- [ ] **Step 1: Subir API + Web local** (API na 3001, web na 3000) e logar como OWNER (`admin@orlandofastpass.com.br`).

- [ ] **Step 2:** Confirmar que o item **"Copiloto"** aparece no menu (com o ícone Sparkles).

- [ ] **Step 3:** Abrir `/copiloto`, mandar "quantas vendas o Pedro fez em julho?" e confirmar resposta com dado real (skill HUB).

- [ ] **Step 4:** Mandar "quem é o cliente do telefone <um telefone real>" e confirmar resposta (skill SQL). Se a skill SQL der erro de conexão, endurecer o `DATABASE_URL`/DSN (fora do escopo desta v1) — anotar.

- [ ] **Step 5 (RBAC):** Logar como um usuário **AGENT** e confirmar que o item **NÃO** aparece e que `POST /copilot/ask` retorna **403**:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<host>/api/v1/copilot/ask \
  -H "Authorization: Bearer <token-de-AGENT>" -H "x-organization-id: <org>" \
  -H "Content-Type: application/json" -d '{"text":"oi"}'
```
Expected: `403`.

- [ ] **Step 6:** Abrir 2 PRs (API + Web) na base `feat/conversation-tabs`. Deploy no VPS (rebuild) pelo Kleber. Sem migração.

---

## Self-Review (feito)

- **Cobertura da spec:** endpoint síncrono (Task 4), resolve agente por category (Task 2), loop reusando LlmService + executores + sanitize (Task 3), ToolContext escopado por org (Task 3), RBAC OWNER/ADMIN (Task 4 + Task 7), front sem persistência/histórico via `history` (Task 6), menu gated (Task 7), sem migração. ✔
- **Placeholders:** nenhum — todo passo tem código/comando reais.
- **Consistência de tipos:** `CopilotTurn` (service) e `CopilotTurn` (front) têm o mesmo shape; `ask(orgId, text, history)` idêntico em service/controller/teste; `askCopilot(text, history)` no front; executores chamados como `execute(skill, skill.tool, args, ctx)` (assinatura real). ✔
