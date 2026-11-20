import { ACTIVE_WINDOW_MS, SocketPresence, UserPresence } from './presence.util';

/**
 * Conexões que caíram há pouco, guardadas com a última atividade.
 *
 * No celular, sair do navegador (WhatsApp, ligação, tela apagada) congela a
 * página e derruba o socket na hora. Sem isso o atendente aparece offline a
 * cada ida ao WhatsApp. Com isso ele continua contando até completar a janela
 * de ativo (5 min) desde o último uso — o mesmo prazo de online → ausente.
 *
 * Em memória: a API roda em um processo só; um restart apenas zera a folga.
 */
export class RecentDisconnects {
  private readonly byKey = new Map<string, UserPresence>();

  record({ organizationId, userId, lastActiveAt }: SocketPresence): void {
    if (!organizationId || !userId) return;
    const key = `${organizationId}:${userId}`;
    const current = this.byKey.get(key);
    if (current && current.lastActiveAt >= lastActiveAt) return;
    this.byKey.set(key, { organizationId, userId, lastActiveAt });
  }

  /** Quem caiu e ainda está dentro da janela de ativo; descarta os vencidos. */
  list(now: Date): UserPresence[] {
    const alive: UserPresence[] = [];
    for (const [key, entry] of this.byKey) {
      if (now.getTime() - entry.lastActiveAt.getTime() > ACTIVE_WINDOW_MS) {
        this.byKey.delete(key);
        continue;
      }
      alive.push(entry);
    }
    return alive;
  }

  size(): number {
    return this.byKey.size;
  }
}
