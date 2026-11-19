import type { LlmService } from '../ai-agents/llm/llm.service';
import type {
  LlmCompletionRequest,
  LlmContent,
  LlmMessage,
  LlmTextPart,
} from '../ai-agents/llm/llm.types';
import {
  stripForeignScripts,
  stripThinkBlocks,
} from '../ai-agents/runner/text-guards';

export const COPILOT_MAX_ITERATIONS = 5;
export const COPILOT_EMPTY_REPLY = 'Não consegui gerar uma resposta agora.';
export const COPILOT_UNFINISHED_REPLY = 'Não consegui concluir a consulta.';

/** Executa uma chamada de ferramenta e devolve o que o modelo deve ver. */
export type ToolDispatcher = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Remove raciocínio `<think>` e caracteres CJK vazados antes de devolver. */
export function cleanReply(text: string): string {
  return stripForeignScripts(stripThinkBlocks(text));
}

export function textOf(content: LlmContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is LlmTextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/**
 * Laço pergunta → ferramentas → resposta, compartilhado pelos dois modos do
 * Copiloto. Erro de ferramenta vira saída `{ ok: false }` para o modelo, nunca
 * derruba a resposta. Devolve o texto final já limpo.
 */
export async function runCopilotToolLoop(
  llm: Pick<LlmService, 'complete'>,
  request: Omit<LlmCompletionRequest, 'messages'>,
  initialMessages: LlmMessage[],
  dispatch: ToolDispatcher,
): Promise<string> {
  const messages = [...initialMessages];
  for (let i = 0; i < COPILOT_MAX_ITERATIONS; i++) {
    const res = await llm.complete({ ...request, messages });
    messages.push(res.message);

    if (res.stopReason !== 'tool_calls' || !res.message.toolCalls?.length) {
      return cleanReply(textOf(res.message.content)) || COPILOT_EMPTY_REPLY;
    }

    for (const call of res.message.toolCalls) {
      let output: unknown;
      try {
        output = await dispatch(call.name, call.arguments ?? {});
      } catch (err) {
        output = { ok: false, error: (err as Error)?.message ?? String(err) };
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
  return (last && cleanReply(textOf(last.content))) || COPILOT_UNFINISHED_REPLY;
}
