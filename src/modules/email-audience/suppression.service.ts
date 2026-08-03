import { Injectable } from '@nestjs/common';
import { EmailSubscriber, EmailSubscriberStatus } from '@prisma/client';

export interface SuppressionVerdict {
  allowed: boolean;
  reason?: string;
}

const BLOCKED: Record<string, string> = {
  [EmailSubscriberStatus.UNSUBSCRIBED]: 'destinatário descadastrado',
  [EmailSubscriberStatus.BOUNCED]: 'endereço com bounce permanente',
  [EmailSubscriberStatus.COMPLAINED]: 'destinatário marcou como spam',
};

@Injectable()
export class SuppressionService {
  /** Portão único de envio. Nenhum email sai sem passar por aqui. */
  canReceive(subscriber: Pick<EmailSubscriber, 'status'> | null): SuppressionVerdict {
    if (!subscriber) return { allowed: false, reason: 'destinatário inexistente' };
    const blocked = BLOCKED[subscriber.status];
    return blocked ? { allowed: false, reason: blocked } : { allowed: true };
  }

  /**
   * Traduz o tipo de bounce do Resend em status de supressão.
   *
   * Só bounce permanente suprime. Caixa cheia e indisponibilidade temporária
   * voltam a funcionar — suprimir por isso jogaria destinatário bom fora.
   * Tipo desconhecido é tratado como temporário pelo mesmo motivo.
   */
  statusForBounce(bounceType?: string | null): EmailSubscriberStatus | null {
    const t = (bounceType ?? '').toLowerCase();
    return t === 'hard' || t === 'permanent' ? EmailSubscriberStatus.BOUNCED : null;
  }
}
