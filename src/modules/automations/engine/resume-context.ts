// Estado mínimo persistido em AutomationRun.resumeState para que um run
// pausado por `delay` seja retomado com o MESMO contexto de cascade/loop
// que teria se rodasse sem pausa. Mantido puro (sem deps) para ser testável.

export interface ResumeState {
  cascadeDepth: number;
  visitedAutomations: string[];
}

export function buildResumeState(state: ResumeState): ResumeState {
  return {
    cascadeDepth: state.cascadeDepth,
    visitedAutomations: [...state.visitedAutomations],
  };
}

export function parseResumeState(raw: unknown): ResumeState {
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as ResumeState).cascadeDepth === 'number' &&
    Array.isArray((raw as ResumeState).visitedAutomations)
  ) {
    const r = raw as ResumeState;
    return {
      cascadeDepth: r.cascadeDepth,
      visitedAutomations: r.visitedAutomations.filter(
        (x): x is string => typeof x === 'string',
      ),
    };
  }
  return { cascadeDepth: 0, visitedAutomations: [] };
}
