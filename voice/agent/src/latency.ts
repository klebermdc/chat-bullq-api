/**
 * Mede a latência de cada turno: do fim da fala do cliente (VAD) até o
 * início da fala da Aline. Recebe os eventos de estado da sessão.
 */
export interface TurnLatency {
  turno: number;
  ms: number;
}

export class LatencyTracker {
  private userStoppedAt: number | null = null;
  private turns: TurnLatency[] = [];

  onUserState(oldState: string, newState: string, at: number): void {
    if (oldState === 'speaking' && newState !== 'speaking') this.userStoppedAt = at;
    if (newState === 'speaking') this.userStoppedAt = null;
  }

  /** Devolve a medição do turno quando a Aline começa a falar depois do cliente. */
  onAgentState(newState: string, at: number): TurnLatency | null {
    if (newState !== 'speaking' || this.userStoppedAt === null) return null;
    const turn = { turno: this.turns.length + 1, ms: Math.round(at - this.userStoppedAt) };
    this.userStoppedAt = null;
    this.turns = [...this.turns, turn];
    return turn;
  }

  summary(): { turnos: number; medianaMs: number; p90Ms: number } | null {
    if (this.turns.length === 0) return null;
    const sorted = [...this.turns].map((t) => t.ms).sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    return { turnos: sorted.length, medianaMs: pick(0.5), p90Ms: pick(0.9) };
  }
}
