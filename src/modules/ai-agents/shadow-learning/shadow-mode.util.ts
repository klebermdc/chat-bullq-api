import { AiAgentMode } from '@prisma/client';

/** True quando o vínculo agente↔canal está em modo observação (não responde). */
export function isShadowMode(mode: AiAgentMode | string | null | undefined): boolean {
  return mode === 'SHADOW';
}
