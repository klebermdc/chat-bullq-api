import { Injectable } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NfseDeliveryError } from './nfse-whatsapp-sender.service';

/** Quanto o endpoint espera o retorno da Meta antes de responder ao Hub. */
export const DELIVERY_WAIT_MS = 12_000;
const DELIVERY_POLL_MS = 500;
const DEFAULT_REASON = 'O WhatsApp não entregou a mensagem.';

/** Códigos da Meta que o Hub precisa entender sem consultar a documentação. */
const KNOWN_CODES: Record<string, string> = {
  '131026': 'Número sem WhatsApp, WhatsApp desatualizado ou que bloqueou a empresa',
  '131053': 'O WhatsApp não conseguiu baixar o PDF',
  '131047': 'Janela de 24h fechada',
};

/** A Meta aceitou o envio e depois avisou (webhook) que não entregou. */
export class NfseUndeliveredError extends NfseDeliveryError {}

export function undeliveredReason(raw: string | null | undefined): string {
  const reason = raw?.trim();
  if (!reason) return DEFAULT_REASON;
  const code = /^\[(\d+)\]/.exec(reason)?.[1];
  const hint = code ? KNOWN_CODES[code] : undefined;
  return hint ? `${hint} (${reason}).` : reason;
}

interface WaitOptions {
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A Meta responde "aceito" (wamid) na hora e só depois informa, pelo webhook
 * de status, se entregou ou falhou (ex.: 131026). Espera esse retorno para o
 * Hub não receber ok:true de uma nota que não chegou.
 */
@Injectable()
export class NfseDeliveryWatcher {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * true = todas entregues; false = nenhuma falha no prazo (aceita pela Meta,
   * sem confirmação). Lança NfseUndeliveredError se alguma falhou.
   */
  async waitOutcome(messageIds: string[], opts: WaitOptions = {}): Promise<boolean> {
    const { waitMs = DELIVERY_WAIT_MS, pollMs = DELIVERY_POLL_MS, sleep = defaultSleep } = opts;
    const rounds = Math.max(1, Math.ceil(waitMs / pollMs));
    for (let round = 0; round <= rounds; round++) {
      const rows = await this.prisma.message.findMany({
        where: { id: { in: messageIds } },
        select: { status: true, failedReason: true },
      });
      const failed = rows.find((r) => r.status === MessageStatus.FAILED);
      if (failed) throw new NfseUndeliveredError(undeliveredReason(failed.failedReason));
      const allDelivered =
        rows.length === messageIds.length &&
        rows.every((r) => r.status === MessageStatus.DELIVERED || r.status === MessageStatus.READ);
      if (allDelivered) return true;
      if (round < rounds) await sleep(pollMs);
    }
    return false;
  }
}
