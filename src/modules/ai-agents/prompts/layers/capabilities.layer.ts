import { Injectable, Logger } from '@nestjs/common';
import { PromptLayer } from '../types';

/**
 * Layer 3 — CAPABILITIES (skills + built-in tools)
 *
 * Lista AS ferramentas que o agent pode chamar e descreve cada uma.
 *
 * - Built-in tools são fixas e vêm como nomes (ex: "replyToConversation"),
 *   o composer renderiza descrição padrão pra cada uma das conhecidas.
 * - Skills da org vêm da tabela AiSkill (Prisma) — usamos só `name`,
 *   `description` e `promptInstructions` (opcional, injetado em destaque).
 *
 * Esta camada é IMUTÁVEL pelo agent — agent não pode "desligar" uma skill
 * via prompt. A lista vem do binding AgentSkill no DB.
 */

/**
 * Descrições canônicas das tools built-in.
 * Mantém alinhado com o registry de tools (ai-agents/tools/*).
 */
const BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
  replyToConversation:
    'replyToConversation(message): envia uma mensagem ao cliente na conversa atual. Use sempre que tiver uma resposta concreta a dar.',
  tagConversation:
    'tagConversation(tags): marca a conversa com tags pra triagem (ex: "billing", "lead-quente", "duvida-tecnica").',
  transferToHuman:
    'transferToHuman(reason, summary): PASSA a conversa pro atendente humano. Esta é a ÚNICA forma de transferir/encerrar seu atendimento. Ao chamá-la, o sistema JÁ avisa o cliente, cria o card no funil (etapa Distribuir) e grava seu resumo — você NÃO faz nada disso na mão. NUNCA escreva a mensagem de despedida/transferência ("vou te passar pro consultor", "já tenho tudo", etc.) como texto: se for transferir, a ação é SEMPRE esta tool, nunca uma resposta em texto. Passe o resumo da qualificação no parâmetro `summary`.',
  delegateToAgent:
    'delegateToAgent(agentId, briefing): transfere a conversa pra outro agent especialista (orquestrador → worker). Handoff é INVISÍVEL ao cliente.',
  handBackToOrchestrator:
    'handBackToOrchestrator(reason): worker devolve a conversa pro orquestrador quando a demanda fugiu da sua especialidade.',
  listAvailableAgents:
    'listAvailableAgents(): lista os agents disponíveis pra delegação. Chame antes do delegateToAgent se ainda não conhece os especialistas.',
  scheduleFollowUp:
    'scheduleFollowUp(delayHours, message): agenda mensagem futura caso o cliente não responda. Use com parcimônia — sistema já agenda follow-ups padrão.',
};

/**
 * Tipo mínimo da skill que esta camada precisa. Ficar acoplado a este shape
 * permite uso fora do contexto Prisma (testes, fixtures) sem quebrar.
 */
export interface SkillForCapabilities {
  name: string;
  description: string;
  category?: string | null;
  promptInstructions?: string | null;
}

@Injectable()
export class CapabilitiesLayerService {
  private readonly logger = new Logger(CapabilitiesLayerService.name);

  /**
   * Constrói a camada de capabilities.
   *
   * Função pura: recebe listas, devolve PromptLayer. Sem DB, sem I/O.
   */
  build(
    skills: SkillForCapabilities[],
    builtinTools: string[],
  ): PromptLayer {
    const sections: string[] = [];

    sections.push('=== FERRAMENTAS DISPONÍVEIS ===');
    sections.push(
      'Você pode chamar APENAS as ferramentas listadas abaixo. Tentar chamar algo fora desta lista falha silenciosamente.',
    );
    sections.push('');

    // ─── Built-in tools ───
    if (builtinTools.length > 0) {
      sections.push('## Tools de plataforma (built-in)');
      for (const toolName of builtinTools) {
        const desc = BUILTIN_TOOL_DESCRIPTIONS[toolName];
        if (desc) {
          sections.push(`- ${desc}`);
        } else {
          // Tool não documentada — registra mas não inventa descrição.
          this.logger.warn(
            { event: 'capabilities_layer_unknown_builtin', toolName },
            `Built-in tool "${toolName}" has no canonical description — listing by name only`,
          );
          sections.push(`- ${toolName}: (sem descrição registrada)`);
        }
      }
      sections.push('');
    }

    // ─── Skills da org (agrupadas por categoria pra leitura mais limpa) ───
    if (skills.length > 0) {
      const byCategory = new Map<string, SkillForCapabilities[]>();
      for (const skill of skills) {
        const cat = skill.category?.trim() || 'Geral';
        const list = byCategory.get(cat) ?? [];
        list.push(skill);
        byCategory.set(cat, list);
      }

      sections.push('## Skills específicas suas');
      for (const [category, skillList] of byCategory) {
        sections.push('');
        sections.push(`### ${category}`);
        for (const skill of skillList) {
          sections.push(`- ${skill.name}: ${skill.description}`);
        }
      }
      sections.push('');

      // Instruções de prompt das skills — bloco separado pra ficar visível
      // (no Chat BullQ atual, isso entra como bullet solto e o LLM ignora).
      const withInstructions = skills.filter(
        (s) => (s.promptInstructions ?? '').trim().length > 0,
      );
      if (withInstructions.length > 0) {
        sections.push('## Como usar as skills (instruções específicas)');
        for (const skill of withInstructions) {
          sections.push('');
          sections.push(`### ${skill.name}`);
          sections.push((skill.promptInstructions ?? '').trim());
        }
        sections.push('');
      }
    }

    // ─── Regras de uso transversais (das tools) ───
    sections.push('## Regras de uso de ferramentas');
    sections.push(
      '- Use os IDs/slugs LITERAIS retornados por uma skill anterior. Não invente, não traduza, não "melhore" o nome.',
    );
    sections.push(
      '- Erro 4xx (404, 400, ambiguidade) de uma skill → PARE. Não retry com nome diferente. Use transferToHuman com motivo.',
    );
    sections.push(
      '- Retry só pra erro transiente (timeout, 500, 503) e no máximo 1 vez.',
    );
    sections.push(
      '- Confirme com o cliente antes de executar ações irreversíveis (liberar acesso, processar pagamento, etc).',
    );
    sections.push(
      '- AÇÃO ≠ TEXTO: nunca ANUNCIE em texto uma ação que tem tool própria — EXECUTE a tool. Se você fosse escrever "vou transferir", "vou te passar pro consultor", "já tenho tudo que preciso" ou qualquer despedida/handoff, a resposta correta NÃO é texto: é chamar transferToHuman. O sistema é quem avisa o cliente e move o card; se você só escrever o texto, o lead fica preso e o time NUNCA recebe.',
    );

    const content = sections.join('\n');
    const tokenEstimate = Math.ceil(content.length / 4);

    this.logger.debug(
      {
        event: 'capabilities_layer_built',
        builtinCount: builtinTools.length,
        skillsCount: skills.length,
        tokenEstimate,
      },
      'Capabilities layer built',
    );

    return {
      kind: 'capabilities',
      content,
      tokenEstimate,
    };
  }
}

/**
 * Helper funcional.
 */
export function buildCapabilitiesLayer(
  skills: SkillForCapabilities[],
  builtinTools: string[],
): PromptLayer {
  return new CapabilitiesLayerService().build(skills, builtinTools);
}
